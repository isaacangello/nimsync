#!/usr/bin/env bun
// nimsync — sincroniza o catálogo NVIDIA NIM com a whitelist de modelos do OpenCode.
//
//   nimsync            TUI interativa (checkboxes, preview, aplicar)
//   nimsync check      relatório de novos/mortos/deprecando (não escreve)
//   nimsync update     aplica mudanças (backup automático; --yes/--all/--dry-run)
//   nimsync list       modelos configurados com origem (✦ nimsync / · manual)
//   nimsync doctor     testa cada modelo configurado com request mínima
//
// Flags: --config <path>  --provider <id>  --refresh  --yes  --all  --dry-run
//        --json  --timeout-ms <n>

import type { CliOptions } from "./types";

import { version as VERSION } from "../package.json";

const HELP = `nimsync v${VERSION} — catálogo NVIDIA NIM ↔ OpenCode

USO
  nimsync [comando] [flags]

COMANDOS
  tui (default)   painel interativo: revisar novos/mortos/deprecando e aplicar
  check           relatório no terminal; não escreve nada (exit 1 = pendências)
  update          aplica na config (backup automático + validação com rollback)
  list            modelos configurados com origem (offline; não escreve)
  doctor          request mínima para cada modelo configurado (chave, latência, rota)

FLAGS
  --config <path>    caminho do opencode.jsonc (default: ~/.config/opencode/opencode.jsonc)
  --provider <id>    id do provider NVIDIA na config (default: detecta pelo baseURL do NIM)
  --refresh          ignora cache (6h) das fontes
  --yes              aceita defaults sem perguntar (update: remove mortos; adiciona só com --all)
  --all              adiciona todos os novos LLMs de chat (update)
  --dry-run          mostra o plano/prévia sem escrever (update)
  --json             saída estruturada (check/update)
  --timeout-ms <n>   timeout por request no doctor (default 45000)
  -h, --help         esta ajuda
  -V, --version      versão

FONTES DE DADOS
  1. /v1/models na sua conta (autoritativo: modelo fora = morto)
  2. models.dev/api.json     (metadados: limites, reasoning_effort, tool_call)
  3. build.nvidia.com        (cards "Deprecation in Nd")

Versão semântica: https://semver.org/lang/pt-BR/
`;

function parseArgs(argv: string[]): { command?: string; opts: CliOptions; help: boolean; version: boolean } {
  const opts: CliOptions = {};
  let command: string | undefined;
  let help = false;
  let version = false;
  const flagsWithArg = new Set(["--config", "--provider", "--timeout-ms"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "-V" || a === "--version") version = true;
    else if (a === "--refresh") opts.refresh = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--restart") opts.restart = true;
    else if (flagsWithArg.has(a)) opts[a.slice(2) as "config" | "provider" | "timeoutMs"] = argv[++i] as never;
    else if (!a.startsWith("-") && !command) command = a;
    else if (a.startsWith("-")) {
      console.error(`flag desconhecida: ${a} (nimsync --help)`);
      process.exit(2);
    }
  }
  return { command, opts, help, version };
}

async function main(): Promise<number> {
  const { command, opts, help, version } = parseArgs(process.argv.slice(2));
  if (version) {
    console.log(VERSION);
    return 0;
  }
  if (help) {
    console.log(HELP);
    return 0;
  }
  const cmd = command ?? "tui";
  switch (cmd) {
    case "check":
      return await import("./cli/check").then((m) => m.runCheck(opts));
    case "list":
      return await import("./cli/list").then((m) => m.runList(opts));
    case "update":
      return await import("./cli/update").then((m) => m.runUpdate(opts));
    case "doctor":
      return await import("./cli/doctor").then((m) => m.runDoctor(opts));
    case "tui":
      return await import("./tui/app").then((m) => m.runTui(opts));
    default:
      console.error(`comando desconhecido: ${cmd} (nimsync --help)`);
      return 2;
  }
}

process.exitCode = await main();
