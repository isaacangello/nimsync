// nimsync providers — painel de provedores suportados: tier, chave, estado.
// Read-only (offline, exceto detecção best-effort do Ollama). exit 0 sempre.

import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { resolveEnv } from "../core/env";
import { managedIdSet } from "../core/managed";
import { allCustomProfiles } from "../core/managed";
import { allProfiles, tierOrder } from "../core/profile";
import type { ProviderProfile } from "../core/profile";
import { defaultConfigPath } from "../core/config";
import { normKey } from "../core/normalize";
import { C } from "../core/context";
import type { CliOptions } from "../types";

interface ProviderStatus {
  profile: ProviderProfile;
  inConfig: boolean;
  configProviderId?: string;
  keyFound: boolean;
  keyEnvFound?: string;
  modelsTotal: number;
  modelsManaged: number;
  custom: boolean;
}

function readProvidersMap(path: string): Record<string, { settings?: { baseURL?: string }; models?: Record<string, unknown> }> {
  try {
    const data = parse(readFileSync(path, "utf8")) as {
      providers?: Record<string, { settings?: { baseURL?: string }; models?: Record<string, unknown> }>;
    };
    return data?.providers ?? {};
  } catch {
    return {};
  }
}

function statusOf(profile: ProviderProfile, providers: ReturnType<typeof readProvidersMap>, custom: boolean): ProviderStatus {
  // provider presente por id, ou por qualquer bloco cuja baseURL case com o padrão
  let configProviderId: string | undefined = providers[profile.providerId] ? profile.providerId : undefined;
  if (!configProviderId) {
    for (const [id, p] of Object.entries(providers)) {
      if (p?.settings?.baseURL && profile.providerUrlPattern.test(p.settings.baseURL)) {
        configProviderId = id;
        break;
      }
    }
  }
  const keyEnvFound = profile.envKeys.find((k) => resolveEnv(k));
  const configured = configProviderId ? Object.keys(providers[configProviderId]?.models ?? {}) : [];
  const managedIds = managedIdSet(profile);
  return {
    profile,
    inConfig: Boolean(configProviderId),
    configProviderId,
    keyFound: Boolean(keyEnvFound),
    keyEnvFound,
    modelsTotal: configured.length,
    modelsManaged: configured.filter((id) => managedIds.has(normKey(id))).length,
    custom,
  };
}

async function detectOllama(): Promise<{ running: boolean; models: number }> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return { running: false, models: 0 };
    const data = (await res.json()) as { models?: unknown[] };
    return { running: true, models: Array.isArray(data.models) ? data.models.length : 0 };
  } catch {
    return { running: false, models: 0 };
  }
}

export async function runProviders(opts: CliOptions): Promise<number> {
  const path = opts.config ?? defaultConfigPath();
  const providers = readProvidersMap(path);

  const statuses: ProviderStatus[] = [...allProfiles(), ...allCustomProfiles()]
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.providerId.localeCompare(b.providerId))
    .map((p) => statusOf(p, providers, false));

  const ollama = await detectOllama();

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          providers: statuses.map((s) => ({
            id: s.profile.providerId,
            name: s.profile.label,
            tier: s.profile.tier,
            custom: s.custom,
            inConfig: s.inConfig,
            configProviderId: s.configProviderId,
            keyFound: s.keyFound,
            keyEnvFound: s.keyEnvFound,
            modelsTotal: s.modelsTotal,
            modelsManaged: s.modelsManaged,
            getKeyUrl: s.profile.getKeyUrl,
          })),
          ollama,
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`${C.bold}nimsync providers${C.reset} — ${path}`);
  console.log(`${C.dim}  filosofia: grátis primeiro · freemium com opt-in · pago só se você pedir${C.reset}\n`);

  const tierColor = { free: C.green, freemium: C.cyan, paid: C.yellow, local: C.dim } as const;
  for (const s of statuses) {
    const p = s.profile;
    const color = tierColor[p.tier];
    const key = s.keyFound
      ? `${C.green}chave ✓${C.reset} ${C.dim}(${s.keyEnvFound})${C.reset}`
      : `${C.yellow}sem chave${C.reset}`;
    const cfg = s.inConfig
      ? `${C.green}configurado ✓${C.reset} ${C.dim}${s.configProviderId} · ${s.modelsTotal} modelos (${s.modelsManaged} gerenciados)${C.reset}`
      : `${C.dim}não configurado${C.reset}`;
    const customTag = s.custom ? ` ${C.magenta}[custom]${C.reset}` : "";
    console.log(`${color}${p.tier.toUpperCase().padEnd(8)}${C.reset} ${C.bold}${p.label}${C.reset}${customTag} ${C.dim}(${p.providerId})${C.reset}`);
    console.log(`          ${key} · ${cfg}`);
    console.log(`          ${C.dim}${p.tierLabel}${C.reset}`);
    if (!s.keyFound && p.getKeyUrl) {
      console.log(`          ${C.dim}→ chave grátis: ${p.getKeyUrl}  ·  export ${p.initApiKeyEnv}="${p.keyExample}"${C.reset}`);
    }
  }

  console.log(
    `\n${C.bold}OLLAMA${C.reset} (local — o OpenCode descobre sozinho em ${C.dim}http://127.0.0.1:11434${C.reset})`
  );
  console.log(
    ollama.running
      ? `  ${C.green}rodando ✓${C.reset} ${C.dim}${ollama.models} modelo(s) locais${C.reset}`
      : `  ${C.dim}não detectado agora (se estiver rodando, o OpenCode lista os modelos no /models)${C.reset}`
  );

  const actionable = statuses.filter((s) => !s.inConfig && s.keyFound);
  if (actionable.length > 0) {
    console.log(`\n${C.cyan}próximo passo:${C.reset} chaves detectadas sem provider na config:`);
    for (const s of actionable) {
      console.log(`  nimsync init --profile ${s.profile.name === "custom" ? "custom" : s.profile.name}${s.custom ? ` --provider ${s.profile.providerId}` : ""}`);
    }
  }
  const missing = statuses.filter((s) => !s.keyFound && s.profile.getKeyUrl);
  if (missing.length > 0) {
    console.log(`${C.dim}grátis esperando chave: ${missing.map((s) => s.profile.label).join(", ")}${C.reset}`);
  }
  return 0;
}
