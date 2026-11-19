// Leitura/escrita cirúrgica do opencode.jsonc:
// - parse tolerante a comentários (jsonc-parser)
// - edições via modify/applyEdits, que preservam o resto do arquivo byte a byte
//   (incluindo os comentários em pt-BR do usuário)
// - backup automático antes da primeira escrita + validação pós-edição com
//   rollback automático se algo sair do trilho

import { applyEdits, modify, parse, type FormattingOptions } from "jsonc-parser";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { addMarker, recordManaged, unrecordManaged } from "./managed";
import { inferProfile, NVIDIA_PROFILE, type ProfileName, type ProviderProfile } from "./profile";

export interface OpencodeConfig {
  path: string;
  text: string;
  data: Record<string, unknown>;
  providerId: string;
  providerBaseURL: string | undefined; // expressão crua (ex.: "{env:NVIDIA_API_URL1}")
  profile: ProviderProfile;
  warnings: string[];
}

export function defaultConfigPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}

const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

/** Localiza o provider do perfil por id preferido, id convencional ou baseURL/env. */
function findProvider(
  data: Record<string, unknown>,
  preferredId: string | undefined,
  profile: ProviderProfile
): { id: string; baseURL: string | undefined } | null {
  const providers = data.providers as Record<string, { settings?: Record<string, unknown> }> | undefined;
  if (!providers) return null;
  const candidates = [preferredId, profile.providerId].filter((x): x is string => Boolean(x));
  for (const id of candidates) {
    if (providers[id]) {
      return { id, baseURL: providers[id].settings?.baseURL as string | undefined };
    }
  }
  for (const [id, p] of Object.entries(providers)) {
    const baseURL = p?.settings?.baseURL;
    // cobre URL real e placeholders {env:NVIDIA_API_URL1}
    if (typeof baseURL === "string" && profile.providerUrlPattern.test(baseURL)) {
      return { id, baseURL };
    }
  }
  return null;
}

export function readConfig(
  path: string,
  preferredProviderId?: string,
  profileName?: ProfileName
): OpencodeConfig {
  const text = readFileSync(path, "utf8");
  const data = parse(text) as Record<string, unknown>;
  if (!data || typeof data !== "object") {
    throw new Error(`não consegui parsear ${path} como JSONC`);
  }
  const profile = inferProfile(preferredProviderId, profileName);
  const warnings: string[] = [];
  const provider = findProvider(data, preferredProviderId, profile);
  if (!provider) {
    throw new Error(
      `nenhum provider ${profile.label} encontrado em ${path} (procurei id "${preferredProviderId ?? profile.providerId}" ou baseURL compatível)`
    );
  }
  const providers = data.providers as Record<string, unknown>;
  const hasModels = Boolean((providers[provider.id] as { models?: unknown })?.models);
  if (!hasModels) warnings.push(`provider "${provider.id}" não tem mapa "models" ainda`);
  return { path, text, data, providerId: provider.id, providerBaseURL: provider.baseURL, profile, warnings };
}

export function configuredModels(cfg: OpencodeConfig): string[] {
  const providers = cfg.data.providers as Record<string, { models?: Record<string, unknown> }>;
  const models = providers?.[cfg.providerId]?.models ?? {};
  return Object.keys(models).sort();
}

export function makeBackup(path: string): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // 20261111094801
  const backup = `${path}.bak-nimsync-${ts}`;
  copyFileSync(path, backup);
  return backup;
}

export interface AddSpec {
  id: string;
  name?: string;
  context?: number;
  output?: number;
  variants?: string[];
  credEnv?: string; // se definido, cria settings.apiKey "{env:VAR}" por modelo
}

export function buildModelDef(
  spec: AddSpec,
  providerBaseURL: string | undefined,
  profile: ProviderProfile = NVIDIA_PROFILE
): Record<string, unknown> {
  const def: Record<string, unknown> = {
    modelID: spec.id,
    name: addMarker(spec.name ?? spec.id, profile), // identifica modelos gerenciados no /models
  };
  if (spec.credEnv) {
    const settings: Record<string, string> = { apiKey: `{env:${spec.credEnv}}` };
    if (providerBaseURL) settings.baseURL = providerBaseURL; // preserva a expressão {env:...}
    def.settings = settings;
  }
  if (spec.context || spec.output) {
    def.limit = {
      ...(spec.context ? { context: spec.context } : {}),
      ...(spec.output ? { output: spec.output } : {}),
    };
  }
  if (spec.variants?.length) {
    def.variants = spec.variants.map((v) => ({ id: v, body: { reasoning_effort: v } }));
  }
  return def;
}

export interface WriteResult {
  backup: string;
  added: string[];
  removed: string[];
}

/**
 * Aplica adições/remoções no mapa models do provider NVIDIA.
 * Valida o resultado (parse + presença/ausência) e faz rollback do backup em caso de falha.
 */
export function applyConfigEdits(
  path: string,
  cfg: OpencodeConfig,
  adds: AddSpec[],
  removes: string[]
): WriteResult {
  if (adds.length === 0 && removes.length === 0) {
    return { backup: "", added: [], removed: [] };
  }
  const backup = makeBackup(path);
  let text = cfg.text;
  const modelsPath = ["providers", cfg.providerId, "models"];

  for (const id of removes) {
    const edits = modify(text, [...modelsPath, id], undefined, { formattingOptions: FORMATTING });
    text = applyEdits(text, edits);
  }
  for (const spec of adds) {
    const def = buildModelDef(spec, cfg.providerBaseURL, cfg.profile);
    const edits = modify(text, [...modelsPath, spec.id], def, { formattingOptions: FORMATTING });
    text = applyEdits(text, edits);
  }

  // validação: precisa parsear e refletir as mudanças
  const after = parse(text) as Record<string, unknown> | undefined;
  const modelsAfter = (after?.providers as Record<string, { models?: Record<string, unknown> }>)?.[
    cfg.providerId
  ]?.models as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (!after || !modelsAfter) {
    problems.push("JSONC resultante não parseou");
  } else {
    for (const a of adds) if (!(a.id in modelsAfter)) problems.push(`${a.id} não foi inserido`);
    for (const r of removes) if (r in modelsAfter) problems.push(`${r} não foi removido`);
  }
  if (problems.length > 0) {
    // rollback: restaura o backup no lugar (renomeia de volta)
    renameSync(backup, path);
    throw new Error(`validação falhou (${problems.join("; ")}) — config restaurada do backup`);
  }
  writeFileSync(path, text);
  // proveniência: registra adds / esquece removes (só depois da escrita validada)
  // entry.name = nome BASE (sem marcador) — a exibição é base + NAME_MARKER
  for (const spec of adds) recordManaged(spec.id, spec.name ?? spec.id, "add", cfg.profile);
  for (const r of removes) unrecordManaged(r, cfg.profile);
  return { backup, added: adds.map((a) => a.id), removed: removes };
}

function initialProviderDef(profile: ProviderProfile): Record<string, unknown> {
  return {
    name: profile.name === "aihubmix" ? "AIHubMix (gratuitos)" : "NVIDIA (selecionados)",
    package: "aisdk:@ai-sdk/openai-compatible",
    settings: {
      apiKey: `{env:${profile.initApiKeyEnv}}`,
      baseURL: profile.baseURL,
      headerTimeout: 600000,
    },
    models: {},
  };
}

/** Prévia do init sem tocar no arquivo. Null significa que o provider já existe. */
export function previewProviderInit(
  path: string,
  profile: ProviderProfile,
  providerId = profile.providerId
): string | null {
  const text = readFileSync(path, "utf8");
  const data = parse(text) as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") throw new Error(`não consegui parsear ${path} como JSONC`);
  const providers = data.providers as Record<string, unknown> | undefined;
  if (providers?.[providerId]) return null;
  return applyEdits(
    text,
    modify(text, ["providers", providerId], initialProviderDef(profile), { formattingOptions: FORMATTING })
  );
}

/** Cria somente o bloco do provider; nunca altera um provider já existente. */
export function initProvider(
  path: string,
  profile: ProviderProfile,
  providerId = profile.providerId
): { backup: string } | null {
  const text = previewProviderInit(path, profile, providerId);
  if (text === null) return null;
  const backup = makeBackup(path);
  const after = parse(text) as Record<string, unknown> | undefined;
  const created = (after?.providers as Record<string, {
    package?: string;
    settings?: Record<string, unknown>;
    models?: Record<string, unknown>;
  }> | undefined)?.[providerId];
  const problems: string[] = [];
  if (!created) problems.push("provider não foi inserido");
  else {
    if (created.package !== "aisdk:@ai-sdk/openai-compatible") problems.push("package incorreto");
    if (created.settings?.apiKey !== `{env:${profile.initApiKeyEnv}}`) problems.push("apiKey incorreta");
    if (created.settings?.baseURL !== profile.baseURL) problems.push("baseURL incorreta");
    if (!created.models || Object.keys(created.models).length !== 0) problems.push("models inicial não está vazio");
  }
  if (problems.length > 0) {
    renameSync(backup, path);
    throw new Error(`validação do init falhou (${problems.join("; ")}) — config restaurada do backup`);
  }
  writeFileSync(path, text);
  return { backup };
}

/** Mapa id → nome de exibição atual dos modelos configurados no provider. */
export function configuredNames(cfg: OpencodeConfig): Record<string, string> {
  const providers = cfg.data.providers as Record<string, { models?: Record<string, { name?: string }> }>;
  const models = providers?.[cfg.providerId]?.models ?? {};
  const out: Record<string, string> = {};
  for (const [id, m] of Object.entries(models)) out[id] = m?.name ?? id;
  return out;
}

export interface RenameResult {
  backup: string;
  renamed: Array<{ id: string; name: string }>;
}

/**
 * Renomeia o campo `name` de modelos existentes — uma escrita, um backup,
 * validação de cada valor e rollback automático em caso de falha.
 */
export function applyNameRenames(
  path: string,
  cfg: OpencodeConfig,
  renames: Array<{ id: string; name: string }>
): RenameResult | null {
  if (renames.length === 0) return null;
  const backup = makeBackup(path);
  let text = cfg.text;
  const modelsPath = ["providers", cfg.providerId, "models"];
  for (const r of renames) {
    const edits = modify(text, [...modelsPath, r.id, "name"], r.name, { formattingOptions: FORMATTING });
    text = applyEdits(text, edits);
  }
  // validação: parseia e confere nome por nome
  const after = parse(text) as Record<string, unknown> | undefined;
  const modelsAfter = (after?.providers as Record<string, { models?: Record<string, { name?: string }> }>)?.[
    cfg.providerId
  ]?.models as Record<string, { name?: string }> | undefined;
  const problems: string[] = [];
  if (!after || !modelsAfter) {
    problems.push("JSONC resultante não parseou");
  } else {
    for (const r of renames) if (modelsAfter[r.id]?.name !== r.name) problems.push(`${r.id} não renomeou`);
  }
  if (problems.length > 0) {
    renameSync(backup, path);
    throw new Error(`validação de renome falhou (${problems.join("; ")}) — config restaurada do backup`);
  }
  writeFileSync(path, text);
  return { backup, renamed: renames };
}

/** Só para testes: aplica em memória e devolve o texto (usado pelo --dry-run). */
export function previewEdits(cfg: OpencodeConfig, adds: AddSpec[], removes: string[]): string {
  let text = cfg.text;
  const modelsPath = ["providers", cfg.providerId, "models"];
  for (const id of removes) {
    text = applyEdits(text, modify(text, [...modelsPath, id], undefined, { formattingOptions: FORMATTING }));
  }
  for (const spec of adds) {
    const def = buildModelDef(spec, cfg.providerBaseURL, cfg.profile);
    text = applyEdits(text, modify(text, [...modelsPath, spec.id], def, { formattingOptions: FORMATTING }));
  }
  return text;
}

export function configDisplayName(path: string): string {
  return basename(path);
}
