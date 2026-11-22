// nimsync check — relatório nas 4 seções, não escreve nada.
// Sem --profile/--provider: itera TODOS os providers configurados (grátis primeiro).
// exit 0 = nada a fazer | 1 = há mudanças pendentes | 2 = erro

import { formatReport, loadContext, loadContextAll, C } from "../core/context";
import { readConfig, configuredModels } from "../core/config";
import { allManaged } from "../core/managed";
import { addableRows, removableRows, deprecatingConfigured } from "../types";
import type { CliOptions } from "../types";

export async function runCheck(opts: CliOptions): Promise<number> {
  if (!opts.provider && !opts.profile) return runCheckAll(opts);
  return runCheckSingle(opts);
}

/** Multi-provider: um relatório por provider configurado, grátis primeiro. */
async function runCheckAll(opts: CliOptions): Promise<number> {
  const loads = await loadContextAll(opts);
  const active = loads.filter((l) => l.ctx);
  const skipped = loads.filter((l) => !l.ctx);

  if (active.length === 0) {
    console.log(`${C.bold}nimsync check${C.reset} — nenhum provider gerenciável no config.`);
    console.log(`${C.dim}  rode nimsync providers para ver o painel e nimsync init para ativar.${C.reset}`);
    for (const s of skipped) {
      if (s.error) console.log(`  ${C.red}${s.profile.label}: ${s.error}${C.reset}`);
    }
    return 0;
  }

  console.log(`${C.bold}nimsync check${C.reset} — ${active.length} provider(s) configurado(s) (grátis primeiro)\n`);
  let pending = 0;
  let lastExit = 0;
  active.forEach((l, i) => {
    const ctx = l.ctx!;
    if (i > 0) console.log(`\n${C.dim}${"─".repeat(72)}${C.reset}`);
    const code = printSingleReport(ctx, opts, /*header*/ true);
    if (code === 1) lastExit = 1;
    pending += addableRows(ctx.report).length + removableRows(ctx.report).length + deprecatingConfigured(ctx.report).length;
  });

  const skipLines = skipped.map((s) => {
    if (s.reason === "not-in-config") return `${C.dim}· ${s.profile.label} — não está no config (nimsync init --profile ${s.profile.name})${C.reset}`;
    if (s.reason === "no-key") return `${C.dim}· ${s.profile.label} — sem chave${s.profile.getKeyUrl ? ` (${s.profile.getKeyUrl})` : ""}${C.reset}`;
    return `${C.yellow}· ${s.profile.label} — ${s.error ?? "erro"}${C.reset}`;
  });
  if (skipLines.length) {
    console.log(`\n${C.bold}não verificados:${C.reset}`);
    skipLines.forEach((l) => console.log(`  ${l}`));
  }

  if (pending === 0) {
    console.log(`\n${C.green}Tudo em ordem — config sincronizada com os catálogos.${C.reset}`);
    return lastExit;
  }
  console.log(
    `\n${C.yellow}${pending} mudança(s) pendente(s).${C.reset} Rode ${C.cyan}nimsync update --profile <provider>${C.reset} (ou a TUI: ${C.cyan}nimsync --profile <provider>${C.reset}).`
  );
  return 1;
}

function runCheckSingle(opts: CliOptions): Promise<number> {
  return (async () => {
    const ctx = await loadContext(opts);
    return printSingleReport(ctx, opts, false);
  })();
}

function printSingleReport(
  ctx: import("../core/context").SyncContext,
  opts: CliOptions,
  multi: boolean
): number {
  const cacheNote = ctx.fromCache ? `${C.dim} (cache 6h; --refresh força re-download)${C.reset}` : "";
  if (!multi) {
    console.log(`${C.bold}nimsync${C.reset} — catálogo ${ctx.profile.label} × ${ctx.configPath} (provider: ${ctx.providerId})`);
  } else {
    console.log(`${C.bold}${ctx.profile.label}${C.reset} ${C.dim}[${ctx.profile.tier}]${C.reset} ${C.dim}(${ctx.providerId})${C.reset}`);
  }
  console.log(`  ${C.green}✓${C.reset} conta ${ctx.profile.label}: ${ctx.report.stats.accountCount} modelos via /v1/models`);
  console.log(`  ${C.green}✓${C.reset} models.dev: ${ctx.report.stats.metaCount} catalogados (${ctx.profile.catalogId})${ctx.profile.hasSite ? "" : cacheNote}`);
  if (ctx.profile.hasSite) {
    console.log(`  ${C.green}✓${C.reset} site: ${ctx.report.stats.siteCount} cards em ~${Math.ceil(ctx.report.stats.siteCount / 24)} página(s)${cacheNote}`);
  } else {
    console.log(`  ${C.dim}site de cards: não aplicável; descoberta por conta + models.dev + sondagem${C.reset}`);
  }
  if (ctx.siteDegraded) {
    console.log(`  ${C.yellow}!${C.reset} site em modo degradado (SSR variou — parte dos cards veio do fallback RSC, sem badges)`);
  }
  console.log(`  ${C.dim}sondagens nesta execução: ${ctx.report.stats.probes}${C.reset}`);
  // proveniência (offline)
  try {
    const cfg = readConfig(opts.config ?? `${process.env.HOME}/.config/opencode/opencode.jsonc`, ctx.providerId, ctx.profile.name);
    const configured = configuredModels(cfg);
    const managedIds = new Set(allManaged(ctx.profile).map(([id]) => id));
    const managedConfigured = configured.filter((id) => managedIds.has(id)).length;
    console.log(
      `  ${C.dim}${managedConfigured}/${configured.length} configurados gerenciados pelo nimsync (nimsync list --provider ${ctx.providerId})${C.reset}`
    );
  } catch {
    // proveniência é informativa — nunca derruba o check
  }

  if (opts.json) {
    console.log(JSON.stringify({ provider: ctx.providerId, report: ctx.report }, null, 2));
  } else {
    process.stdout.write(formatReport(ctx.report, C, ctx.profile));
  }

  const pending =
    addableRows(ctx.report).length +
    removableRows(ctx.report).length +
    deprecatingConfigured(ctx.report).length;
  if (pending === 0) {
    if (!multi) console.log(`\n${C.green}Tudo em ordem — config sincronizada com o catálogo.${C.reset}`);
    return 0;
  }
  if (!multi) {
    console.log(
      `\n${C.yellow}${pending} mudança(s) pendente(s).${C.reset} Rode ${C.cyan}nimsync update${C.reset} (ou a TUI: ${C.cyan}nimsync${C.reset}).`
    );
  }
  return 1;
}
