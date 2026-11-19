#!/usr/bin/env bun
// nimsync — sincroniza NVIDIA NIM e AIHubMix com a whitelist do OpenCode.
//
//   nimsync            TUI interativa (checkboxes, preview, aplicar)
//   nimsync init       cria o provider selecionado (backup + validação)
//   nimsync check      relatório de novos/mortos/deprecando (não escreve)
//   nimsync update     aplica mudanças (backup automático; --yes/--all/--dry-run)
//   nimsync list       modelos configurados com origem (✦ nimsync / · manual)
//   nimsync doctor     testa cada modelo configurado com request mínima

import type { CliOptions } from "./types";
import { isProfileName } from "./core/profile";
import { version as VERSION } from "../package.json";

const HELP = `nimsync v${VERSION} — NVIDIA NIM + AIHubMix ↔ OpenCode

USO
  nimsync [comando] [flags]

COMANDOS
  tui (default)   painel interativo: revisar novos/mortos/deprecando e aplicar
  init            cria o bloco do provider sem alterar providers existentes
  check           relatório no terminal; não escreve nada (exit 1 = pendências)
  update          aplica na config (backup automático + validação com rollback)
  list            modelos configurados com origem (offline; não escreve)
  doctor          request mínima para cada modelo configurado (chave, latência, rota)

FLAGS
  --profile <nome>   nvidia (default) ou aihubmix
  --config <path>    caminho do opencode.jsonc (default: ~/.config/opencode/opencode.jsonc)
  --provider <id>    id do provider na config; "aihubmix" também infere o perfil
  --refresh          ignora cache (6h) das fontes
  --yes              aceita defaults sem perguntar (update: remove mortos; adiciona só com --all)
  --all              adiciona todos os novos LLMs de chat gratuitos/elegíveis (update)
  --dry-run          mostra o plano/prévia sem escrever (init/update)
  --json             saída estruturada (init/check/update)
  --timeout-ms <n>   timeout por request (sondagens/doctor; default do doctor: 60000)
  -h, --help         esta ajuda
  -V, --version      versão

AIHUBMIX
  nimsync init --profile aihubmix
  nimsync check --provider aihubmix --refresh
  nimsync update --provider aihubmix --yes --all
  Somente IDs terminados em -free/:free ou custo 0/0 no models.dev entram por padrão.
  Chave: AIHUBMIX_API_KEY, com fallback para AIHUBMIX. Marcador no /models: " ·MIX".

FONTES DE DADOS
  1. /v1/models na sua conta + sondagem real (a listagem sozinha não é veredito)
  2. models.dev/api.json (metadados: limites, custo, reasoning_effort, tool_call)
  3. build.nvidia.com (somente NVIDIA: badges e "Deprecation in Nd")

Versão semântica: https://semver.org/lang/pt-BR/
`;

function parseArgs(argv: string[]): { command?: string; opts: CliOptions; help: boolean; version: boolean } {
  const opts: CliOptions = {};
  let command: string | undefined;
  let help = false;
  let version = false;
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
    else if (a === "--no-probe") opts.noProbe = true;
    else if (a === "--config" || a === "--provider" || a === "--profile" || a === "--timeout-ms") {
      const value = argv[++i];
      if (!value) throw new Error(`${a} exige um valor`);
      if (a === "--config") opts.config = value;
      else if (a === "--provider") opts.provider = value;
      else if (a === "--timeout-ms") {
        const timeout = Number(value);
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout-ms deve ser um número positivo");
        opts.timeoutMs = timeout;
      } else {
        if (!isProfileName(value)) throw new Error(`perfil desconhecido: ${value} (use nvidia ou aihubmix)`);
        opts.profile = value;
      }
    } else if (!a.startsWith("-") && !command) command = a;
    else if (a.startsWith("-")) throw new Error(`flag desconhecida: ${a} (nimsync --help)`);
    else throw new Error(`argumento inesperado: ${a}`);
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
    case "init":
      return await import("./cli/init").then((m) => m.runInit(opts));
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

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`nimsync: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
