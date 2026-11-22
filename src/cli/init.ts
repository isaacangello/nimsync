// nimsync init — cria um provider no opencode.jsonc sem tocar nos demais.
//
// Modos:
//   init --profile <nome>                    → cria o perfil built-in
//   init --profile custom --provider <id> \
//        --base-url <url> --key-env <VAR>    → qualquer endpoint OpenAI-compatible
//   init (sem flags, zero providers ativos)  → wizard de onboarding (grátis primeiro)
//
// Usa a mesma edição JSONC cirúrgica, backup e validação com rollback do update.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { defaultConfigPath, initProvider, previewProviderInit } from "../core/config";
import { allProfiles, customProfileFromDef, type CustomProfileDef, type ProviderProfile } from "../core/profile";
import { resolveProfile } from "../core/resolve";
import { allCustomProfiles, saveCustomProfile } from "../core/managed";
import { resolveEnv } from "../core/env";
import { C } from "../core/context";
import { version as VERSION } from "../../package.json";
import type { CliOptions } from "../types";

export async function runInit(opts: CliOptions): Promise<number> {
  // ---- perfil custom: exige os argumentos de definição
  if (opts.profile === "custom") {
    if (!opts.provider || !opts.baseUrl || !opts.keyEnv) {
      console.error("init --profile custom exige --provider <id>, --base-url <url> e --key-env <VAR>");
      return 2;
    }
    return initCustom(opts);
  }

  // ---- perfil explícito (ou inferido por --provider)
  if (opts.profile || opts.provider) {
    const profile = resolveProfile(opts.provider, opts.profile);
    return initExplicit(opts, profile, opts.provider ?? profile.providerId);
  }

  // ---- sem flags: wizard quando nada configurado; dica quando já há algo
  return runWizard(opts);
}

async function initExplicit(opts: CliOptions, profile: ProviderProfile, providerId: string): Promise<number> {
  const path = opts.config ?? defaultConfigPath();
  const preview = previewProviderInit(path, profile, providerId);

  if (preview === null) {
    if (opts.json) console.log(JSON.stringify({ provider: providerId, created: false }, null, 2));
    else console.log(`provider "${providerId}" já existe em ${path} — nada a fazer`);
    return 0;
  }
  if (opts.dryRun) {
    if (opts.json) console.log(JSON.stringify({ provider: providerId, created: false, dryRun: true, preview }, null, 2));
    else {
      console.log(`${C.dim}--- prévia do init (dry-run, nada foi escrito) ---${C.reset}`);
      console.log(preview);
    }
    return 0;
  }

  const result = initProvider(path, profile, providerId);
  if (opts.json) {
    console.log(JSON.stringify({ provider: providerId, created: Boolean(result), backup: result?.backup ?? "" }, null, 2));
  } else if (result) {
    console.log(`${C.green}✓ provider ${profile.label} criado${C.reset} (${providerId}) — backup: ${C.dim}${result.backup}${C.reset}`);
    console.log(`  ${C.dim}próximo passo: nimsync check --provider ${providerId} --refresh${C.reset}`);
  }
  return 0;
}

async function initCustom(opts: CliOptions): Promise<number> {
  const path = opts.config ?? defaultConfigPath();
  const providerId = opts.provider!;
  const marker = opts.marker ?? ` ·${providerId.split("-")[0].toUpperCase().slice(0, 4)}`;
  const def: CustomProfileDef = {
    providerId,
    label: providerId,
    baseURL: opts.baseUrl!,
    envKeys: [opts.keyEnv!],
    initApiKeyEnv: opts.keyEnv!,
    keyExample: "sk-... (OpenAI-compatible)",
    marker,
    tier: "paid",
    createdAt: new Date().toISOString(),
    version: VERSION,
  };
  const profile = customProfileFromDef(def);
  const preview = previewProviderInit(path, profile, providerId);
  if (preview === null) {
    console.log(`provider "${providerId}" já existe em ${path} — nada a fazer`);
    return 0;
  }
  if (opts.dryRun) {
    console.log(`${C.dim}--- prévia do init custom (dry-run) ---${C.reset}`);
    console.log(preview);
    return 0;
  }
  const result = initProvider(path, profile, providerId);
  if (result) {
    saveCustomProfile(def); // registra para check/update/providers multi-provider
    console.log(`${C.green}✓ provider custom criado${C.reset} (${providerId} → ${def.baseURL}) — backup: ${C.dim}${result.backup}${C.reset}`);
    console.log(`  ${C.dim}tier: pago (tudo opt-in) · marcador "${marker}" · chave: ${"$"}{env:${def.initApiKeyEnv}}${C.reset}`);
    console.log(`  ${C.dim}próximo passo: nimsync check --provider ${providerId} --refresh${C.reset}`);
  }
  return 0;
}

// ---------- wizard de onboarding ----------

function configHasAnyManagedProvider(path: string): boolean {
  try {
    const data = parse(readFileSync(path, "utf8")) as { providers?: Record<string, unknown> };
    const providers = data?.providers ?? {};
    const builtIn = allProfiles().some((p) => Boolean(providers[p.providerId]));
    const custom = allCustomProfiles().some((p) => Boolean(providers[p.providerId]));
    return builtIn || custom;
  } catch {
    return false;
  }
}

async function runWizard(opts: CliOptions): Promise<number> {
  const path = opts.config ?? defaultConfigPath();
  if (configHasAnyManagedProvider(path)) {
    console.log(`${C.bold}nimsync init${C.reset} — escolha um perfil: ${C.dim}nimsync init --profile nvidia|google|groq|openrouter|aihubmix${C.reset}`);
    console.log(`${C.dim}  (ou crie um custom: init --profile custom --provider <id> --base-url <url> --key-env <VAR>)${C.reset}`);
    return 0;
  }

  console.log(`${C.bold}nimsync — onboarding${C.reset}`);
  console.log(`${C.dim}nenhum provider configurado ainda. A filosofia: GRÁTIS primeiro — pago é sempre opt-in.${C.reset}\n`);

  const candidates = allProfiles();
  candidates.forEach((p, i) => {
    const hasKey = p.envKeys.some((k) => resolveEnv(k));
    const key = hasKey ? `${C.green}chave detectada ✓${C.reset}` : `${C.yellow}sem chave${C.reset}`;
    console.log(`  ${i + 1}. ${C.bold}${p.label}${C.reset} ${C.dim}[${p.tier}]${C.reset} — ${key} ${C.dim}${p.tierLabel}${C.reset}`);
  });

  const pick = await ask(`\nAtivar qual? (1-${candidates.length}, vazio = sair) `);
  if (pick.eof) {
    console.log(`${C.dim}saindo — rode nimsync init quando quiser.${C.reset}`);
    return 0;
  }
  const idx = Number(pick.text);
  if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
    console.log(`${C.dim}saindo — rode nimsync init quando quiser.${C.reset}`);
    return 0;
  }
  const profile = candidates[idx - 1];

  // garante a chave antes de escrever o bloco
  for (;;) {
    if (profile.envKeys.some((k) => resolveEnv(k))) break;
    console.log(`\n${C.yellow}Chave ${profile.label} não encontrada.${C.reset}`);
    if (profile.getKeyUrl) console.log(`  1. crie a chave grátis em: ${C.cyan}${profile.getKeyUrl}${C.reset}`);
    console.log(`  2. adicione ao ~/.zshrc:  ${C.cyan}export ${profile.initApiKeyEnv}="${profile.keyExample}"${C.reset}`);
    console.log(`  3. recarregue:            ${C.cyan}source ~/.zshrc${C.reset}`);
    const again = await ask(`\n[enter] quando a chave estiver no ambiente · (s)air: `);
    if (again.eof || /^s/i.test(again.text)) {
      // EOF de stdin (pipe fechado) encerra graciosamente — nunca entra em loop
      console.log(`${C.dim}saindo.${C.reset}`);
      return 0;
    }
  }

  return initExplicit({ ...opts, profile: profile.name }, profile, profile.providerId);
}

/** Resposta do usuário. `eof=true` = stdin fechado (pipe encerrado). */
interface Answer {
  text: string;
  eof: boolean;
}

/** True depois que o stdin terminou — perguntas seguintes resolvem como EOF. */
let stdinClosed = false;

/**
 * Pergunta no terminal. Se o stdin terminar (pipe fechado), resolve com
 * eof=true em vez de ficar esperando — evita loop infinito no wizard.
 */
async function ask(prompt: string): Promise<Answer> {
  if (stdinClosed || stdin.readableEnded || stdin.destroyed) {
    stdinClosed = true;
    return { text: "", eof: true };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await new Promise<Answer>((resolve) => {
      let settled = false;
      const finish = (text: string, eof: boolean): void => {
        if (settled) return;
        settled = true;
        if (eof) stdinClosed = true;
        resolve({ text: text.trim(), eof });
      };
      // 'close' dispara quando o stdin acaba (EOF) — nesse caso a pergunta não
      // recebe callback, então resolvemos manualmente.
      rl.once("close", () => finish("", true));
      rl.question(prompt).then(
        (answer) => finish(answer, false),
        () => finish("", true)
      );
    });
  } finally {
    rl.close();
  }
}
