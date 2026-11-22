// nimsync restore (alias: reset) — volta a config a um backup anterior.
//
// Os backups são os arquivos `opencode.jsonc.bak-nimsync-<ts>` que o nimsync
// cria antes de cada escrita. O comando lista os disponíveis e restaura o
// escolhido.
//
// Segurança: antes de sobrescrever a config atual, o nimsync cria OUTRO backup
// (o estado atual) — ou seja, o próprio restore é reversível.
//
// A proveniência (managed.json) NÃO é tocada: ela tolera dessincronia (modelo
// gerenciado que não está na config é simplesmente ignorado).
//
// exit 0 = restaurado/listado | 1 = erro de uso | 2 = erro

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { parse } from "jsonc-parser";
import { restoreBackup } from "../core/config";
import { C } from "../core/context";
import { confirmWrite, printJson } from "./prompt";
import type { CliOptions } from "../types";

export interface BackupInfo {
  path: string;
  id: string;
  size: number;
  mtime: string;
  providers: number;
  models: number;
}

export async function runRestore(opts: CliOptions): Promise<number> {
  const configPath = opts.config ?? defaultPath();
  if (!existsSync(configPath)) {
    console.error(`config não encontrada: ${configPath}`);
    return 2;
  }
  const backups = listBackups(configPath);

  // ---- só listar
  if (opts.listOnly) {
    if (opts.json) {
      printJson({ command: "restore", config: configPath, backups, written: false });
      return 0;
    }
    printBackups(backups, configPath);
    return 0;
  }

  if (backups.length === 0) {
    console.error(`nenhum backup encontrado para ${configPath}`);
    console.error(`${C.dim}esperado: ${basename(configPath)}.bak-nimsync-<timestamp>${C.reset}`);
    return 2;
  }

  // ---- escolhe o backup
  let chosen: BackupInfo | undefined;
  if (opts.backup) {
    const wanted = opts.backup.trim();
    chosen = backups.find((b) => b.id === wanted || b.path === wanted || basename(b.path) === wanted);
    if (!chosen && existsSync(wanted)) {
      // caminho absoluto/incompleto: aceita se existir e for um arquivo
      chosen = {
        path: wanted,
        id: basename(wanted).replace(/^.*\.bak-nimsync-/, ""),
        size: statSync(wanted).size,
        mtime: new Date(statSync(wanted).mtimeMs).toISOString(),
        providers: 0,
        models: 0,
      };
    }
    if (!chosen) {
      console.error(`${C.red}backup não encontrado:${C.reset} ${wanted}`);
      printBackups(backups, configPath);
      return 1;
    }
  } else if (opts.latest) {
    chosen = backups[0]; // já vem em ordem (mais recente primeiro)
  } else {
    printBackups(backups, configPath);
    console.error(`\n${C.dim}escolha um: nimsync restore --backup <id> | --latest | --list${C.reset}`);
    return 1;
  }

  const current = summarize(configPath);

  // ---- modo --json: só o plano, nada é escrito
  if (opts.json) {
    printJson({
      command: "restore",
      config: configPath,
      restoreFrom: chosen.path,
      current,
      backup: { providers: chosen.providers, models: chosen.models },
      written: false,
    });
    return 0;
  }

  console.log(`${C.bold}nimsync restore${C.reset} — ${configPath}`);
  console.log(`  ${C.dim}atual:${C.reset} ${current.providers} provider(s), ${current.models} modelo(s)`);
  console.log(`  ${C.dim}backup:${C.reset} ${chosen.path} ${C.dim}(${chosen.providers} provider(s), ${chosen.models} modelo(s))${C.reset}`);

  if (opts.dryRun) {
    console.log(`\n${C.dim}--- dry-run: nada foi escrito ---${C.reset}`);
    return 0;
  }

  if (!(await confirmWrite(opts, `Restaurar este backup? (s/n) `))) {
    console.log(`${C.dim}cancelado — nada foi escrito.${C.reset}`);
    return 1;
  }

  const result = restoreBackup(configPath, chosen.path);
  const after = summarize(configPath);
  console.log(`${C.green}✓ config restaurada${C.reset} — ${after.providers} provider(s), ${after.models} modelo(s)`);
  console.log(`  ${C.dim}backup de segurança (estado anterior): ${result.safetyBackup}${C.reset}`);
  console.log(`  ${C.dim}proveniência (managed.json) não foi alterada${C.reset}`);
  console.log(`\n${C.dim}próximo passo: opencode service restart${C.reset}`);
  return 0;
}

/** Backups da config, do mais recente para o mais antigo. */
export function listBackups(configPath: string): BackupInfo[] {
  const dir = dirname(configPath);
  const base = basename(configPath);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    // opencode.jsonc.bak-nimsync-20261119175252  (e o legado .bak-nvidia-<ts>)
    const m = name.match(/^.*\.bak-(?:nimsync|nvidia)-([0-9]{8,14})\.?$/);
    if (!m) continue;
    const path = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    const s = summarize(path);
    out.push({
      path,
      id: m[1],
      size: st.size,
      mtime: new Date(st.mtimeMs).toISOString(),
      providers: s.providers,
      models: s.models,
    });
  }
  out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return out;
}

function printBackups(backups: BackupInfo[], configPath: string): void {
  const current = summarize(configPath);
  console.log(`${C.bold}nimsync restore${C.reset} — backups de ${configPath}`);
  console.log(`  ${C.dim}atual: ${current.providers} provider(s), ${current.models} modelo(s)${C.reset}\n`);
  if (backups.length === 0) {
    console.log(`  ${C.dim}nenhum backup encontrado${C.reset}`);
    return;
  }
  for (const b of backups) {
    const when = b.mtime.slice(0, 16).replace("T", " ");
    const diff =
      b.models === current.models ? "" : ` ${C.yellow}(≠ atual: ${current.models})${C.reset}`;
    console.log(
      `  ${C.bold}${b.id}${C.reset} ${C.dim}${when}${C.reset} ${C.dim}${b.providers} provider(s) · ${b.models} modelo(s)${C.reset}${diff}`
    );
    console.log(`      ${C.dim}${b.path}${C.reset}`);
  }
  console.log(`\n${C.dim}nimsync restore --backup <id> | --latest | --list${C.reset}`);
}

/** providers e modelos de um arquivo de config (contagem simples, tolerante). */
function summarize(path: string): { providers: number; models: number } {
  try {
    const data = parse(readFileSync(path, "utf8")) as {
      providers?: Record<string, { models?: Record<string, unknown> }>;
    } | undefined;
    const providers = data?.providers ?? {};
    let models = 0;
    for (const p of Object.values(providers)) models += Object.keys(p?.models ?? {}).length;
    return { providers: Object.keys(providers).length, models };
  } catch {
    return { providers: 0, models: 0 };
  }
}

function defaultPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}
