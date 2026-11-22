// nimsync uninstall --provider <id> — remove um provider da config.
//
// Remove o bloco `providers.<id>` (cirurgia JSONC: o resto do arquivo fica
// byte a byte igual, comentários inclusive), limpa a proveniência do provider
// e desregistra perfis custom.
//
// NÃO mexe na chave do ~/.zshrc — a credencial é do usuário.
//
// exit 0 = removido | 1 = cancelado/nada a fazer | 2 = erro

import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { readConfig, removeProviderBlock, configuredModels } from "../core/config";
import { clearManaged, removeCustomProfile, allCustomProfiles } from "../core/managed";
import { C } from "../core/context";
import { confirmWrite, printJson } from "./prompt";
import type { CliOptions } from "../types";

export async function runUninstall(opts: CliOptions): Promise<number> {
  const configPath = opts.config ?? defaultPath();
  if (!opts.provider) {
    console.error("uso: nimsync uninstall --provider <id>");
    return 2;
  }

  // o provider precisa existir na config — resolveProfile() pode lançar se o
  // id não for nem built-in nem custom registrado, então checamos antes.
  const providerIds = listProviderIds(configPath);
  if (!providerIds.includes(opts.provider)) {
    console.error(`${C.red}provider "${opts.provider}" não está na config${C.reset} ${configPath}`);
    if (providerIds.length > 0) {
      console.error(`${C.dim}presentes:${C.reset} ${providerIds.join(", ")}`);
    }
    return 1;
  }

  const cfg = readConfig(configPath, opts.provider, opts.profile);
  const providerId = cfg.providerId;
  const profile = cfg.profile;
  const models = configuredModels(cfg);
  const isCustom = allCustomProfiles().some((p) => p.providerId === providerId);

  // ---- modo --json: só o plano, nada é escrito
  if (opts.json) {
    printJson({
      command: "uninstall",
      provider: providerId,
      profile: profile.name,
      models: models.length,
      custom: isCustom,
      written: false,
    });
    return 0;
  }

  console.log(`${C.bold}nimsync uninstall${C.reset} — ${providerId} ${C.dim}(${profile.label})${C.reset}`);
  console.log(`  ${C.red}−${C.reset} bloco do provider em ${configPath} ${C.dim}(${models.length} modelo(s))${C.reset}`);
  console.log(`  ${C.red}−${C.reset} proveniência do provider em managed.json`);
  if (isCustom) {
    console.log(`  ${C.red}−${C.reset} perfil custom em profiles.json`);
  }
  console.log(`\n  ${C.dim}a chave no ~/.zshrc NÃO é tocada — remova a mão se quiser${C.reset}`);

  if (opts.dryRun) {
    console.log(`\n${C.dim}--- dry-run: nada foi escrito ---${C.reset}`);
    return 0;
  }

  if (!(await confirmWrite(opts, `Remover o provider "${providerId}" da config? (s/n) `))) {
    console.log(`${C.dim}cancelado — nada foi escrito.${C.reset}`);
    return 1;
  }

  const result = removeProviderBlock(configPath, providerId);
  if (!result) {
    console.log(`${C.yellow}provider "${providerId}" não está na config — nada a fazer${C.reset}`);
    return 1;
  }
  const cleared = clearManaged(profile);
  if (isCustom) removeCustomProfile(providerId);

  console.log(`${C.green}✓ provider "${providerId}" removido${C.reset} — backup: ${C.dim}${result.backup}${C.reset}`);
  console.log(`  ${C.dim}proveniência limpa: ${cleared} entrada(s)${C.reset}`);
  if (isCustom) console.log(`  ${C.dim}perfil custom desregistrado${C.reset}`);
  console.log(`\n${C.dim}próximo passo: opencode service restart${C.reset}`);
  return 0;
}

function defaultPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}

/** Ids de providers presentes na config (para mensagens de erro claras). */
function listProviderIds(path: string): string[] {
  try {
    const data = parse(readFileSync(path, "utf8")) as { providers?: Record<string, unknown> } | undefined;
    return Object.keys(data?.providers ?? {});
  } catch {
    return [];
  }
}
