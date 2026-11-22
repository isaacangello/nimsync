#!/usr/bin/env bun
// nimsync — sincroniza providers de IA com a whitelist de modelos do OpenCode.
// Filosofia: GRÁTIS primeiro (chave gratuita) · freemium com opt-in · pago só se você pedir.
//
//   nimsync                TUI interativa (checkboxes, preview, aplicar)
//   nimsync providers      painel de provedores: tier, chave, estado (read-only)
//   nimsync init           cria provider (+ wizard de onboarding e perfis custom)
//   nimsync check          relatório de TODOS os providers configurados (não escreve)
//   nimsync update         aplica mudanças num provider (backup + validação c/ rollback)
//   nimsync list           modelos configurados com origem (offline)
//   nimsync doctor         testa cada modelo configurado com request mínima

import type { CliOptions } from "./types";
import { isProfileName } from "./core/profile";
import { version as VERSION } from "../package.json";

const HELP = `nimsync v${VERSION} — providers de IA ↔ OpenCode (grátis primeiro)

USO
  nimsync [comando] [flags]

COMANDOS
  tui (default)   painel interativo: revisar novos/mortos/deprecando e aplicar
  providers       painel de provedores: tier (free/freemium/paid/local), chave, estado
  init            cria o provider no opencode.jsonc (+ wizard se nada configurado)
  check           relatório de TODOS os providers configurados (exit 1 = pendências)
  update          aplica mudanças num provider (backup automático + rollback)
  add <id...>     adiciona modelo(s) por ID (sonda antes; usa metadados do models.dev)
  remove <id...>  remove modelo(s) da config (por ID, vivo ou morto)
  refresh-meta    atualiza limites/variantes dos modelos já configurados
  restore         volta a um backup .bak-nimsync-<ts> (alias: reset)
  uninstall       remove um provider da config (+ proveniência e perfil custom)
  list            modelos configurados com origem (offline; não escreve)
  doctor          request mínima para cada modelo configurado (chave, latência, rota)

PROVIDERS BUILT-IN
  nvidia       free      NVIDIA NIM trial (build.nvidia.com)        marcador " ·NIM"
  google       free      Google AI Studio (cota por conta)          marcador " ·GEM"
  groq         free      Groq (cota por conta)                      marcador " ·GROQ"
  openrouter   freemium  só IDs ":free" entram por padrão           marcador " ·OR"
  aihubmix     freemium  só "-free/:free" entram por padrão         marcador " ·MIX"
  custom       paid      qualquer endpoint OpenAI-compatible (seu)

FLAGS
  --profile <nome>   nvidia | google | groq | openrouter | aihubmix | custom
  --config <path>    caminho do opencode.jsonc (default: ~/.config/opencode/opencode.jsonc)
  --provider <id>    id do provider na config; também infere o perfil
  --refresh          ignora cache (6h) das fontes
  --include-paid     incluir modelos PAGOS como candidatos (freemium; nunca é default)
  --yes              aceita defaults sem perguntar (update: remove mortos; adiciona só com --all)
  --all              adiciona todos os novos elegíveis (update) · refresh-meta: inclui manuais
  --dry-run          mostra o plano/prévia sem escrever (init/update/add/remove/refresh-meta)
  --json             saída estruturada (providers/init/check/update/add/remove/restore/uninstall)
  --timeout-ms <n>   timeout por request (sondagens/doctor; default do doctor: 60000)
  --no-probe         não sonda (add: adiciona sem confirmar que o modelo responde)
  --allow-lower      refresh-meta: permite REDUZIR limites (por padrão só amplia)
  --backup <id>      restore: timestamp do backup (ex: 20261119175252) ou caminho
  --latest           restore: usa o backup mais recente
  --list             restore: só lista os backups disponíveis

CRUD DE MODELOS
  nimsync add <id...>      adiciona por ID (sonda obrigatória; --no-probe pula)
  nimsync remove <id...>   remove por ID (qualquer modelo configurado)
  nimsync refresh-meta     recalcula limit.context/output e variants (mostra o diff)
  nimsync restore --list   lista backups · --latest restaura o mais recente
  nimsync uninstall --provider <id>   remove o bloco do provider (config + estado)

INIT CUSTOM (qualquer gateway OpenAI-compatible)
  nimsync init --profile custom --provider meugateway \\
    --base-url https://meugateway.example/v1 --key-env MEUGATEWAY_API_KEY [--marker " ·GW"]

ONBOARDING
  nimsync init   (sem nenhum provider) → wizard: grátis primeiro, mostra onde criar a chave

FONTES DE DADOS
  1. /v1/models na sua conta + sondagem real (a listagem sozinha não é veredito)
  2. models.dev/api.json (metadados: limites, custo, reasoning_effort, tool_call)
  3. build.nvidia.com (somente NVIDIA: badges e "Deprecation in Nd")

Versão semântica: https://semver.org/lang/pt-BR/
`;

function parseArgs(argv: string[]): {
  command?: string;
  args: string[];
  opts: CliOptions;
  help: boolean;
  version: boolean;
} {
  const opts: CliOptions = {};
  const args: string[] = [];
  let command: string | undefined;
  let help = false;
  let version = false;
  const flagsWithArg = new Set([
    "--config",
    "--provider",
    "--profile",
    "--timeout-ms",
    "--base-url",
    "--key-env",
    "--marker",
    "--backup",
  ]);
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
    else if (a === "--include-paid") opts.includePaid = true;
    else if (a === "--latest") opts.latest = true;
    else if (a === "--list") opts.listOnly = true;
    else if (a === "--allow-lower") opts.allowLower = true;
    else if (flagsWithArg.has(a)) {
      const value = argv[++i];
      if (!value) throw new Error(`${a} exige um valor`);
      if (a === "--config") opts.config = value;
      else if (a === "--provider") opts.provider = value;
      else if (a === "--base-url") opts.baseUrl = value;
      else if (a === "--key-env") opts.keyEnv = value;
      else if (a === "--marker") opts.marker = value;
      else if (a === "--backup") opts.backup = value;
      else if (a === "--timeout-ms") {
        const timeout = Number(value);
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout-ms deve ser um número positivo");
        opts.timeoutMs = timeout;
      } else {
        if (!isProfileName(value)) {
          throw new Error(`perfil desconhecido: ${value} (use nvidia|google|groq|openrouter|aihubmix|custom)`);
        }
        opts.profile = value;
      }
    } else if (!a.startsWith("-") && !command) command = a;
    else if (!a.startsWith("-")) args.push(a);
    else throw new Error(`flag desconhecida: ${a} (nimsync --help)`);
  }
  return { command, args, opts, help, version };
}

async function main(): Promise<number> {
  const { command, args, opts, help, version } = parseArgs(process.argv.slice(2));
  if (version) {
    console.log(VERSION);
    return 0;
  }
  if (help) {
    console.log(HELP);
    return 0;
  }
  const cmd = command ?? "tui";
  // add/remove recebem IDs como posicionais: nimsync add <id> [<id>...]
  if (cmd === "add" || cmd === "remove") opts.modelIds = args;
  switch (cmd) {
    case "providers":
      return await import("./cli/providers").then((m) => m.runProviders(opts));
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
    case "add":
      return await import("./cli/add").then((m) => m.runAdd(opts));
    case "remove":
      return await import("./cli/remove").then((m) => m.runRemove(opts));
    case "refresh-meta":
      return await import("./cli/refresh").then((m) => m.runRefreshMeta(opts));
    case "restore":
    case "reset":
      return await import("./cli/restore").then((m) => m.runRestore(opts));
    case "uninstall":
      return await import("./cli/uninstall").then((m) => m.runUninstall(opts));
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
