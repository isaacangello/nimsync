// nimsync add <id...> — adiciona modelo(s) por ID, à mão.
//
// Diferente do `update --all` (que só oferece o que foi DESCOBERTO no
// catálogo/conta/site), aqui o usuário escolhe o ID explicitamente. A sonda
// continua obrigatória por padrão: um ID que não responde não entra na config.
//
// exit 0 = tudo certo | 1 = nada foi adicionado (IDs recusados) | 2 = erro

import { readConfig, configuredModels, applyConfigEdits, type AddSpec } from "../core/config";
import { resolveEnv } from "../core/env";
import { fetchModelsDev } from "../sources/modelsdev";
import { probeChatModel } from "../sources/slugmap";
import { effortValues } from "../core/diff";
import { C } from "../core/context";
import { confirmWrite, printJson } from "./prompt";
import type { CliOptions } from "../types";
import type { ModelsDevModel } from "../types";
import { normKey } from "../core/normalize";

interface Candidate {
  id: string;
  meta?: ModelsDevModel;
  verdict?: "alive" | "alive-paid" | "alive-quota" | "gone" | "inconclusive";
  accepted: boolean;
  reason?: string;
  paid?: boolean;
}

export async function runAdd(opts: CliOptions): Promise<number> {
  const ids = (opts.modelIds ?? []).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error("uso: nimsync add <model-id> [<model-id> ...] [--provider <id>]");
    return 2;
  }

  const cfg = readConfig(opts.config ?? defaultPath(), opts.provider, opts.profile);
  const profile = cfg.profile;
  const configured = new Set(configuredModels(cfg).map(normKey));

  // ---- metadados (nome, limites, reasoning_effort) do catálogo do provider
  const meta = await fetchModelsDev(Boolean(opts.refresh), profile.catalogId);
  const metaByNorm = new Map<string, ModelsDevModel>();
  for (const [id, m] of Object.entries(meta)) metaByNorm.set(normKey(id), m);

  // ---- chave (necessária para a sonda)
  const apiKey = profile.envKeys.map((k) => resolveEnv(k)).find(Boolean);

  const candidates: Candidate[] = [];
  for (const id of ids) {
    if (configured.has(normKey(id))) {
      candidates.push({ id, accepted: false, reason: "já configurado" });
      continue;
    }
    const m = metaByNorm.get(normKey(id));
    const cand: Candidate = { id, meta: m, accepted: false };
    // --no-probe: entra sem sondar e sem precisar de chave
    if (opts.noProbe) {
      cand.accepted = true;
      cand.reason = "adicionado sem sonda (--no-probe)";
      candidates.push(cand);
      continue;
    }
    if (!apiKey) {
      cand.reason = `sem chave ${profile.label} para sondar (use --no-probe para adicionar sem confirmar)`;
      candidates.push(cand);
      continue;
    }
    const verdict = await probeChatModel(apiKey, id, opts.timeoutMs ? Number(opts.timeoutMs) : 20_000, profile);
    cand.verdict = verdict;
    if (verdict === "alive" || verdict === "alive-quota") {
      cand.accepted = true;
      cand.reason = verdict === "alive-quota" ? "respondeu 429 (vivo, com cota)" : "respondeu";
    } else if (verdict === "alive-paid") {
      // o usuário pediu o ID explicitamente: entra, mas avisado
      cand.accepted = true;
      cand.paid = true;
      cand.reason = "rota viva, mas exige saldo (403) — adicionada por pedido explícito";
    } else if (verdict === "gone") {
      cand.reason = "a sonda confirmou o fim (404/410) — não entra";
    } else {
      cand.reason = "sonda inconclusiva (fila/rede) — rode de novo ou use --no-probe";
    }
    candidates.push(cand);
  }

  const accepted = candidates.filter((c) => c.accepted);
  const refused = candidates.filter((c) => !c.accepted);

  const specs: AddSpec[] = accepted.map((c) => ({
    id: c.id,
    name: c.meta?.name ?? c.id,
    context: c.meta?.limit?.context,
    output: c.meta?.limit?.output,
    variants: effortValues(c.meta, profile),
    paid: c.paid,
  }));

  // ---- modo --json: só o plano, nada é escrito
  if (opts.json) {
    printJson({
      command: "add",
      provider: cfg.providerId,
      profile: profile.name,
      added: specs.map((s) => s.id),
      refused: refused.map((c) => ({ id: c.id, reason: c.reason })),
      written: false,
    });
    return accepted.length > 0 ? 0 : 1;
  }

  // ---- plano (sempre mostrado)
  console.log(`${C.bold}nimsync add${C.reset} — ${profile.label} ${C.dim}(${cfg.providerId})${C.reset}`);
  for (const c of candidates) {
    const mark = c.accepted ? `${C.green}+${C.reset}` : `${C.red}✗${C.reset}`;
    const tag = c.paid ? ` ${C.magenta}[$]${C.reset}` : "";
    console.log(`  ${mark} ${c.id}${tag} ${C.dim}— ${c.reason ?? ""}${C.reset}`);
  }
  if (accepted.length === 0) {
    console.log(`\n${C.yellow}nada a adicionar.${C.reset}`);
    return 1;
  }

  if (opts.dryRun) {
    console.log(`\n${C.dim}--- dry-run: nada foi escrito ---${C.reset}`);
    console.log(`  ${accepted.map((s) => s.id).join(", ")}`);
    return 0;
  }

  // ---- confirmação (TTY) — nada é aplicado sem s
  if (!(await confirmWrite(opts, `Adicionar ${accepted.length} modelo(s)? (s/n) `))) {
    console.log(`${C.dim}cancelado — nada foi escrito.${C.reset}`);
    return 1;
  }

  const result = applyConfigEdits(cfg.path, cfg, specs, []);
  console.log(
    `${C.green}✓ ${result.added.length} modelo(s) adicionado(s)${C.reset} — backup: ${C.dim}${result.backup}${C.reset}`
  );
  for (const a of result.added) console.log(`  ${C.green}+${C.reset} ${a}`);
  if (refused.length > 0) {
    console.log(`\n${C.yellow}${refused.length} recusado(s).${C.reset}`);
  }
  console.log(`\n${C.dim}próximo passo: opencode service restart${C.reset}`);
  return 0;
}

function defaultPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}
