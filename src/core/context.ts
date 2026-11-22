// Contexto compartilhado: carrega config, as fontes e computa o Report (v2).
// Reutilizado por check, update, tui e doctor.

import { readConfig, configuredModels } from "./config";
import { resolveEnv } from "./env";
import { computeReport } from "./diff";
import { fetchAccountModels } from "../sources/nim-api";
import { fetchModelsDev } from "../sources/modelsdev";
import { fetchSiteCards } from "../sources/buildsite";
import { clearSlugMap } from "../sources/slugmap";
import { addableRows, removableRows, deprecatingConfigured } from "../types";
import type { CliOptions, Report, SiteModel } from "../types";
import { NVIDIA_PROFILE, allProfiles, type ProviderProfile } from "./profile";
import { allCustomProfiles } from "./managed";

export interface SyncContext {
  configPath: string;
  providerId: string;
  profile: ProviderProfile;
  report: Report;
  fromCache: boolean;
  siteDegraded: boolean;
}

export async function loadContext(opts: CliOptions): Promise<SyncContext> {
  const configPath = opts.config ?? defaultConfigPath();
  const cfg = readConfig(configPath, opts.provider, opts.profile);
  const configured = configuredModels(cfg);
  const profile = cfg.profile;

  const apiKey = profile.envKeys.map((key) => resolveEnv(key)).find(Boolean);
  if (!apiKey) {
    throw new Error(`chave ${profile.label} não encontrada (procurei ${profile.envKeys.join(", ")} em process.env e ~/.zshrc)`);
  }
  if (opts.refresh && profile.hasSite) clearSlugMap();

  const emptySite: { cards: SiteModel[]; degraded: boolean } = { cards: [], degraded: false };
  const [account, meta, site] = await Promise.all([
    fetchAccountModels(apiKey, 30_000, profile.baseURL),
    fetchModelsDev(Boolean(opts.refresh), profile.catalogId),
    profile.hasSite ? fetchSiteCards(Boolean(opts.refresh)) : Promise.resolve(emptySite),
  ]);

  const report = await computeReport({
    configured,
    account,
    meta,
    siteCards: site.cards,
    apiKey,
    profile,
    refresh: opts.refresh,
    noProbe: opts.noProbe,
    timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
    includePaid: opts.includePaid,
  });

  return {
    configPath,
    providerId: cfg.providerId,
    profile,
    report,
    fromCache: !opts.refresh,
    siteDegraded: site.degraded,
  };
}

/**
 * Multi-provider: perfis gerenciáveis presentes na config E com chave resolvível.
 * Ordem: grátis → freemium → pago (a filosofia do projeto).
 */
export interface ProfileLoad {
  profile: ProviderProfile;
  ctx?: SyncContext;
  error?: string;
  reason?: "not-in-config" | "no-key";
}

export function candidateProfiles(configPath: string): ProviderProfile[] {
  const customs = allCustomProfiles();
  return [...allProfiles(), ...customs];
}

export async function loadContextAll(opts: CliOptions): Promise<ProfileLoad[]> {
  const configPath = opts.config ?? defaultConfigPath();
  const out: ProfileLoad[] = [];
  const profiles = candidateProfiles(configPath).sort(
    (a, b) => tierRank(a) - tierRank(b) || a.providerId.localeCompare(b.providerId)
  );
  for (const profile of profiles) {
    const load: ProfileLoad = { profile };
    try {
      const inConfig = configHasProvider(configPath, profile);
      if (!inConfig) {
        load.reason = "not-in-config";
      } else if (!profile.envKeys.some((k) => resolveEnv(k))) {
        load.reason = "no-key";
      } else {
        load.ctx = await loadContext({ ...opts, provider: profile.providerId, profile: profile.name });
      }
    } catch (err) {
      load.error = err instanceof Error ? err.message : String(err);
    }
    out.push(load);
  }
  return out;
}

function tierRank(p: ProviderProfile): number {
  const order = { free: 0, freemium: 1, paid: 2, local: 3 } as const;
  return order[p.tier];
}

/** O provider do perfil está no opencode.jsonc (por id ou baseURL compatível)? */
function configHasProvider(configPath: string, profile: ProviderProfile): boolean {
  try {
    const cfg = readConfig(configPath, profile.providerId, profile.name);
    return Boolean(cfg.providerId);
  } catch {
    return false;
  }
}

function defaultConfigPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}

export const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
};

const ORIGIN_TAG: Record<string, string> = {
  "site+md": "site+md",
  site: "site",
  md: "md",
  account: "conta",
  "site-only": "site",
};

function rowLine(r: import("../types").ModelRow, colors: typeof C): string {
  const { dim, reset, magenta } = colors;
  const tag = `${dim}[${ORIGIN_TAG[r.origin] ?? r.origin}]${reset}`;
  const paid = r.paidModel ? ` ${magenta}[$]${reset}` : "";
  const effort = r.meta?.reasoning_options?.find((o) => o.type === "effort")?.values;
  const eff = effort?.length ? ` ${dim}[effort: ${effort.join("/")}]${reset}` : "";
  const ctx = r.meta?.limit?.context ? ` ${dim}${Math.round(r.meta.limit.context / 1024)}K${reset}` : "";
  return `  ${tag} ${r.id}${paid}${eff}${ctx}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Relatório nas 4 seções, ordenadas por confiança da origem. */
export function formatReport(report: Report, colors = C, profile: ProviderProfile = NVIDIA_PROFILE): string {
  const out: string[] = [];
  const { green, red, yellow, dim, cyan, reset, bold } = colors;
  const { freeEndpoint: fe, noFreeEndpoint: nfe, modelsdevOnly: mdo, rest } = report;

  // ---- seção 1: elegíveis à whitelist
  const novos = fe.filter((r) => r.status === "new-ready");
  const config = fe.filter((r) => r.configured && r.status === "alive");
  const deprec = fe.filter((r) => r.status === "deprecating");
  const dead = fe.filter((r) => r.status === "dead");
  const paid = fe.filter((r) => r.status === "paid");
  const inconc = fe.filter((r) => r.status === "inconclusive");

  const section1 = profile.hasSite
    ? "SITE · FREE ENDPOINT — elegíveis ao trial"
    : profile.freeFilter
      ? `GRATUITOS · ${profile.label.toUpperCase()} — whitelist por ID/custo`
      : `ELEGÍVEIS · ${profile.label.toUpperCase()} — catálogo da conta (${profile.tierLabel})`;
  out.push(`\n${bold}1) ${section1} (${fe.length})${reset}`);
  if (novos.length) {
    out.push(`  ${green}${bold}NOVOS prontos (${novos.length}):${reset}`);
    for (const r of novos) {
      out.push(`${green}  +${reset} ${rowLine(r, colors)}`);
      if (r.description) out.push(`${dim}      ${truncate(r.description, 100)}${reset}`);
      if (r.apiId) out.push(`${dim}      (ID real: ${r.apiId})${reset}`);
    }
  }
  if (config.length) {
    out.push(`  ${green}JÁ CONFIGURADOS e vivos (${config.length}):${reset}`);
    for (const r of config) out.push(`${green}  ✓${reset} ${rowLine(r, colors)}`);
  }
  if (deprec.length) {
    out.push(`  ${yellow}DEPRECANDO (${deprec.length}):${reset}`);
    for (const r of deprec) {
      const quando =
        r.deprecationDays != null
          ? `Deprecation in ${r.deprecationDays}d (${r.deprecationSource})`
          : r.note ?? "";
      out.push(`${yellow}  ~${reset} ${rowLine(r, colors)} ${dim}— ${quando}${reset}`);
    }
  }
  if (dead.length) {
    out.push(`  ${red}MORTOS — confirmados por sondagem (${dead.length}):${reset}`);
    for (const r of dead) {
      out.push(`${red}  ✗${reset} ${rowLine(r, colors)}${r.configured ? ` ${dim}— remova! ${r.note ?? ""}${reset}` : ` ${dim}— ${r.note ?? ""}${reset}`}`);
    }
  }
  if (paid.length) {
    out.push(`  ${yellow}VIVOS, MAS PAGOS/SALDO INSUFICIENTE (${paid.length}) — nunca remover como mortos:${reset}`);
    for (const r of paid) out.push(`${yellow}  $${reset} ${rowLine(r, colors)} ${dim}— ${r.note ?? ""}${reset}`);
  }
  if (inconc.length) {
    out.push(`  ${yellow}INCONCLUSIVOS (${inconc.length}) — rode de novo mais tarde:${reset}`);
    for (const r of inconc) out.push(`${yellow}  ?${reset} ${rowLine(r, colors)} ${dim}— ${r.note ?? ""}${reset}`);
  }
  if (fe.length === 0) out.push(`  ${dim}${profile.hasSite ? "nenhum card com Free Endpoint" : "nenhum modelo elegível encontrado"}${reset}`);

  // ---- seção 2: fora da whitelist gratuita
  const section2 = profile.hasSite
    ? "SITE · SEM FREE ENDPOINT — containers/download"
    : profile.freeFilter
      ? "PAGOS / FORA DA WHITELIST GRATUITA — use --include-paid (ou toggle p) como opt-in"
      : "FORA DA LISTAGEM DA CONTA (só no models.dev)";
  out.push(`\n${bold}2) ${section2} (${nfe.length})${reset}`);
  for (const r of nfe.slice(0, 10)) out.push(`${dim}  ·${reset} ${rowLine(r, colors)} ${dim}— ${truncate(r.description ?? r.note ?? "", 80)}${reset}`);
  if (nfe.length > 10) out.push(`  ${dim}+${nfe.length - 10} restantes${reset}`);

  // ---- seção 3: MODELS.DEV ONLY
  out.push(`\n${bold}3) MODELS.DEV ONLY — catalogados sem card no site (${mdo.length})${reset}`);
  for (const r of mdo.slice(0, 10)) out.push(`${dim}  ·${reset} ${rowLine(r, colors)} ${dim}— ${truncate(r.note ?? "", 80)}${reset}`);
  if (mdo.length > 10) out.push(`  ${dim}+${mdo.length - 10} restantes${reset}`);

  // ---- seção 4: RESTO
  out.push(`\n${bold}4) RESTO — na conta, sem metadados de chat (${rest.length})${reset}`);
  for (const r of rest.slice(0, 8)) out.push(`${dim}  ·${reset} ${r.id} ${dim}— ${truncate(r.note ?? "", 80)}${reset}`);
  if (rest.length > 8) out.push(`  ${dim}+${rest.length - 8} restantes${reset}`);

  out.push("");
  return out.join("\n");
}

export { addableRows, removableRows, deprecatingConfigured };
