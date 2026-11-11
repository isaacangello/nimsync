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
import type { CliOptions, Report } from "../types";

export interface SyncContext {
  configPath: string;
  providerId: string;
  report: Report;
  fromCache: boolean;
  siteDegraded: boolean;
}

export async function loadContext(opts: CliOptions): Promise<SyncContext> {
  const configPath = opts.config ?? defaultConfigPath();
  const cfg = readConfig(configPath, opts.provider);
  const configured = configuredModels(cfg);

  const apiKey = resolveEnv("NVIDIA_API_KEY");
  if (!apiKey) {
    throw new Error("chave NVIDIA não encontrada (procurei NVIDIA_API_KEY em process.env e ~/.zshrc)");
  }
  if (opts.refresh) clearSlugMap();

  const [account, meta, site] = await Promise.all([
    fetchAccountModels(apiKey),
    fetchModelsDev(Boolean(opts.refresh)),
    fetchSiteCards(Boolean(opts.refresh)),
  ]);

  const report = await computeReport({
    configured,
    account,
    meta,
    siteCards: site.cards,
    apiKey,
    refresh: opts.refresh,
    noProbe: opts.noProbe,
    timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
  });

  return {
    configPath,
    providerId: cfg.providerId,
    report,
    fromCache: !opts.refresh,
    siteDegraded: site.degraded,
  };
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
  const { dim, reset } = colors;
  const tag = `${dim}[${ORIGIN_TAG[r.origin] ?? r.origin}]${reset}`;
  const effort = r.meta?.reasoning_options?.find((o) => o.type === "effort")?.values;
  const eff = effort?.length ? ` ${dim}[effort: ${effort.join("/")}]${reset}` : "";
  const ctx = r.meta?.limit?.context ? ` ${dim}${Math.round(r.meta.limit.context / 1024)}K${reset}` : "";
  return `  ${tag} ${r.id}${eff}${ctx}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Relatório nas 4 seções, ordenadas por confiança da origem. */
export function formatReport(report: Report, colors = C): string {
  const out: string[] = [];
  const { green, red, yellow, dim, cyan, reset, bold } = colors;
  const { freeEndpoint: fe, noFreeEndpoint: nfe, modelsdevOnly: mdo, rest } = report;

  // ---- seção 1: SITE · FREE ENDPOINT
  const novos = fe.filter((r) => r.status === "new-ready");
  const config = fe.filter((r) => r.configured && r.status === "alive");
  const deprec = fe.filter((r) => r.status === "deprecating");
  const dead = fe.filter((r) => r.status === "dead");
  const inconc = fe.filter((r) => r.status === "inconclusive");

  out.push(`\n${bold}1) SITE · FREE ENDPOINT — elegíveis ao trial (${fe.length})${reset}`);
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
  if (inconc.length) {
    out.push(`  ${yellow}INCONCLUSIVOS (${inconc.length}) — rode de novo mais tarde:${reset}`);
    for (const r of inconc) out.push(`${yellow}  ?${reset} ${rowLine(r, colors)} ${dim}— ${r.note ?? ""}${reset}`);
  }
  if (fe.length === 0) out.push(`  ${dim}nenhum card com Free Endpoint${reset}`);

  // ---- seção 2: SITE · SEM FREE ENDPOINT
  out.push(`\n${bold}2) SITE · SEM FREE ENDPOINT — containers/download (${nfe.length})${reset}`);
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
