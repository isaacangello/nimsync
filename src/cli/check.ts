// nimsync check — relatório nas 4 seções, não escreve nada.
// exit 0 = nada a fazer | 1 = há mudanças pendentes | 2 = erro

import { formatReport, loadContext, C } from "../core/context";
import { addableRows, removableRows, deprecatingConfigured } from "../types";
import type { CliOptions } from "../types";

export async function runCheck(opts: CliOptions): Promise<number> {
  const ctx = await loadContext(opts);
  const cacheNote = ctx.fromCache ? `${C.dim} (cache 6h; --refresh força re-download)${C.reset}` : "";
  console.log(`${C.bold}nimsync${C.reset} — catálogo NVIDIA × ${ctx.configPath} (provider: ${ctx.providerId})`);
  console.log(`  ${C.green}✓${C.reset} conta NVIDIA: ${ctx.report.stats.accountCount} modelos via /v1/models`);
  console.log(`  ${C.green}✓${C.reset} models.dev: ${ctx.report.stats.metaCount} catalogados (nvidia)`);
  console.log(`  ${C.green}✓${C.reset} site: ${ctx.report.stats.siteCount} cards em ~${Math.ceil(ctx.report.stats.siteCount / 24)} página(s)${cacheNote}`);
  if (ctx.siteDegraded) {
    console.log(`  ${C.yellow}!${C.reset} site em modo degradado (SSR variou — parte dos cards veio do fallback RSC, sem badges)`);
  }
  console.log(`  ${C.dim}sondagens nesta execução: ${ctx.report.stats.probes}${C.reset}`);

  if (opts.json) {
    console.log(JSON.stringify(ctx.report, null, 2));
  } else {
    process.stdout.write(formatReport(ctx.report, C));
  }

  const pending =
    addableRows(ctx.report).length +
    removableRows(ctx.report).length +
    deprecatingConfigured(ctx.report).length;
  if (pending === 0) {
    console.log(`\n${C.green}Tudo em ordem — config sincronizada com o catálogo.${C.reset}`);
    return 0;
  }
  console.log(
    `\n${C.yellow}${pending} mudança(s) pendente(s).${C.reset} Rode ${C.cyan}nimsync update${C.reset} (ou a TUI: ${C.cyan}nimsync${C.reset}).`
  );
  return 1;
}
