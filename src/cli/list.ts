// nimsync list — modelos configurados no provider NVIDIA, com origem.
// Somente leitura (offline): opencode.jsonc + ~/.local/state/nimsync/managed.json.
// exit 0 sempre.

import { readConfig, configuredNames } from "../core/config";
import { allManaged, hasMarker, NAME_MARKER } from "../core/managed";
import type { CliOptions } from "../types";

const C = { reset: "\x1b[0m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", bold: "\x1b[1m" };

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "?" : d.toLocaleDateString("pt-BR");
}

export async function runList(opts: CliOptions): Promise<number> {
  const cfg = readConfig(opts.config ?? `${process.env.HOME}/.config/opencode/opencode.jsonc`, opts.provider);
  const names = configuredNames(cfg);
  const managed = new Map(allManaged());

  const rows = Object.entries(names).map(([id, name]) => {
    const m = managed.get(id);
    return { id, name, m };
  });
  rows.sort((a, b) => (b.m ? 1 : 0) - (a.m ? 1 : 0) || a.id.localeCompare(b.id));

  console.log(`${C.bold}nimsync list${C.reset} — ${rows.length} modelo(s) em ${cfg.path} (provider: ${cfg.providerId})\n`);

  const unmanaged = rows.filter((r) => !r.m);
  if (unmanaged.length > 0 && !rows.some((r) => r.m)) {
    // nenhum gerenciado registrado: sugere a migração
    console.log(`  ${C.dim}nenhum modelo registrado como gerenciado — rode nimsync update para migrar${C.reset}\n`);
  }

  for (const r of rows) {
    if (r.m) {
      const via = r.m.via === "add" ? "nimsync" : "migração";
      console.log(
        `  ${C.cyan}✦${C.reset} ${r.name}${C.dim}  (${r.id}) — ${via} ${r.m.version} em ${fmtDate(r.m.addedAt)}${C.reset}`
      );
    } else {
      console.log(`  ${C.dim}·${C.reset} ${hasMarker(r.name) ? r.name : r.name} ${C.dim}(${r.id}) — manual/fora do registro${C.reset}`);
    }
  }

  const marked = rows.filter((r) => hasMarker(r.name)).length;
  console.log(
    `\n  ${C.green}${managed.size}${C.reset} gerenciado(s) pelo nimsync · ${marked} com o marcador "${C.cyan}${NAME_MARKER.trim()}${C.reset}" no /models do OpenCode`
  );
  if (marked < managed.size) {
    console.log(`  ${C.dim}→ rode nimsync update para marcar os que faltam${C.reset}`);
  }
  return 0;
}
