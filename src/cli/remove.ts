// nimsync remove <id...> — remove modelo(s) da config por ID.
//
// Diferente do `update` (que só remove mortos confirmados por sonda), aqui o
// usuário escolhe o que tirar — inclusive modelos vivos que não quer mais.
// A proveniência é limpa junto: se o modelo voltar ao catálogo, ele será
// oferecido de novo como "novo".
//
// exit 0 = removido | 1 = nada removido | 2 = erro

import { readConfig, configuredModels, applyConfigEdits } from "../core/config";
import { allManaged } from "../core/managed";
import { C } from "../core/context";
import { confirmWrite, printJson } from "./prompt";
import type { CliOptions } from "../types";
import { normKey } from "../core/normalize";

export async function runRemove(opts: CliOptions): Promise<number> {
  const ids = (opts.modelIds ?? []).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error("uso: nimsync remove <model-id> [<model-id> ...] [--provider <id>]");
    return 2;
  }

  const cfg = readConfig(opts.config ?? defaultPath(), opts.provider, opts.profile);
  const configured = configuredModels(cfg);
  const byNorm = new Map(configured.map((id) => [normKey(id), id] as const));
  const managedIds = new Set(allManaged(cfg.profile).map(([id]) => normKey(id)));

  const found: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const real = byNorm.get(normKey(id));
    if (real) found.push(real);
    else missing.push(id);
  }

  if (missing.length > 0) {
    console.error(`${C.red}não configurado(s):${C.reset} ${missing.join(", ")}`);
    console.error(`${C.dim}configurados neste provider (${configured.length}):${C.reset}`);
    console.error(`  ${configured.join("\n  ")}`);
    return 1;
  }
  if (found.length === 0) {
    console.log(`${C.yellow}nada a remover.${C.reset}`);
    return 1;
  }

  const manuals = found.filter((id) => !managedIds.has(normKey(id)));

  // ---- modo --json: só o plano, nada é escrito
  if (opts.json) {
    printJson({
      command: "remove",
      provider: cfg.providerId,
      profile: cfg.profile.name,
      removed: found,
      manual: manuals,
      written: false,
    });
    return 0;
  }

  console.log(`${C.bold}nimsync remove${C.reset} — ${cfg.profile.label} ${C.dim}(${cfg.providerId})${C.reset}`);
  for (const id of found) {
    const tag = managedIds.has(normKey(id)) ? `${C.cyan}gerenciado${C.reset}` : `${C.yellow}manual${C.reset}`;
    console.log(`  ${C.red}-${C.reset} ${id} ${C.dim}(${tag})${C.reset}`);
  }
  if (manuals.length > 0) {
    console.log(
      `\n${C.yellow}atenção:${C.reset} ${manuals.length} modelo(s) não foram gerenciados pelo nimsync — sairão da config.`
    );
  }

  if (opts.dryRun) {
    console.log(`\n${C.dim}--- dry-run: nada foi escrito ---${C.reset}`);
    console.log(`  ${found.join(", ")}`);
    return 0;
  }

  if (!(await confirmWrite(opts, `Remover ${found.length} modelo(s) da config? (s/n) `))) {
    console.log(`${C.dim}cancelado — nada foi escrito.${C.reset}`);
    return 1;
  }

  const result = applyConfigEdits(cfg.path, cfg, [], found);
  console.log(
    `${C.green}✓ ${result.removed.length} modelo(s) removido(s)${C.reset} — backup: ${C.dim}${result.backup}${C.reset}`
  );
  for (const r of result.removed) console.log(`  ${C.red}-${C.reset} ${r}`);
  console.log(`\n${C.dim}próximo passo: opencode service restart${C.reset}`);
  return 0;
}

function defaultPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}
