// nimsync check — relatório colorido, não escreve nada.
// exit 0 = nada a fazer | 1 = há mudanças pendentes | 2 = erro

import { formatDiff, loadContext, C } from "../core/context";
import type { CliOptions } from "../types";

export async function runCheck(opts: CliOptions): Promise<number> {
  const ctx = await loadContext(opts);
  const cacheNote = ctx.fromCache ? `${C.dim} (cache 6h; --refresh força re-download)${C.reset}` : "";
  console.log(`${C.bold}nimsync${C.reset} — verificando catálogo NVIDIA × ${ctx.configPath}`);
  console.log(`  ${C.green}✓${C.reset} conta NVIDIA: ${ctx.accountCount} modelos via /v1/models`);
  console.log(`  ${C.green}✓${C.reset} models.dev: ${ctx.metaCount} modelos catalogados (nvidia)`);
  console.log(`  ${C.green}✓${C.reset} site: ${ctx.siteCount} cards em ~${ctx.sitePages} página(s)${cacheNote}`);
  if (ctx.siteDegraded) {
    console.log(`  ${C.yellow}!${C.reset} site em modo degradado (SSR variou — alguns cards sem badge/nome)`);
  }

  if (opts.json) {
    console.log(JSON.stringify(ctx.diff, null, 2));
  } else {
    process.stdout.write(formatDiff(ctx.diff, C));
  }

  const pending =
    ctx.diff.newModels.length + ctx.diff.deadModels.length + ctx.diff.deprecating.length;
  if (pending === 0) {
    console.log(`\n${C.green}Tudo em ordem — config sincronizada com o catálogo.${C.reset}`);
    return 0;
  }
  console.log(
    `\n${C.yellow}${pending} mudança(s) pendente(s).${C.reset} Rode ${C.cyan}nimsync update${C.reset} para aplicar (ou a TUI: ${C.cyan}nimsync${C.reset}).`
  );
  return 1;
}
