// Perfis dos providers suportados pelo nimsync.
//
// O perfil NVIDIA é o default para preservar a interface e o comportamento anteriores.
// Tiers (a filosofia do projeto: GRÁTIS primeiro, pago sempre opt-in):
//   free     — só precisa de uma chave gratuita (NVIDIA trial, Google AI Studio, Groq)
//   freemium — tem subconjunto gratuito (AIHubMix -free/:free, OpenRouter :free)
//   paid     — requer saldo/crédito (profiles "custom" do usuário)
//   local    — roda na máquina (Ollama: detecção apenas, OpenCode já integra)

import type { ModelsDevModel } from "../types";

export type ProfileName = "nvidia" | "aihubmix" | "google" | "groq" | "openrouter" | "custom";
export type Tier = "free" | "freemium" | "paid" | "local";
export type ProbeClassification = "gone" | "alive-paid" | "alive-quota" | null;

export interface ProviderProfile {
  name: ProfileName;
  providerId: string;
  label: string;
  catalogId: string; // id no models.dev (metadados)
  baseURL: string;
  backupBaseURL?: string;
  envKeys: string[];
  initApiKeyEnv: string;
  keyExample: string;
  dedicatedKeyPrefix: string;
  marker: string;
  providerUrlPattern: RegExp;
  hasSite: boolean;
  /** A listagem da conta não garante que a rota responde. */
  probeAccountConfigured: boolean;
  probeAccountCandidates: boolean;
  defaultEffortValues: string[];
  /** free=trial/chave grátis · freemium=tem subconjunto grátis · paid · local */
  tier: Tier;
  tierLabel: string;
  /** Onde criar a chave gratuita (quando aplicável). */
  getKeyUrl?: string;
  /** Campo `package` do bloco no opencode.jsonc (aisdk:<npm> ou pacote nativo do OpenCode). */
  configPackage: string;
  /** Provider native do OpenCode já conhece o endpoint? (não escrever settings.baseURL) */
  configBaseURL: boolean;
  /** Nome do provider exibido no OpenCode na criação pelo init. */
  initialLabel: string;
  /** Sondagem direta por ID (profiles sem slug de site). false = variantes de slug NVIDIA. */
  probeDirect: boolean;
  /** Classifica não-gratuitos como "notfree" (freemium). false = tudo é candidato. */
  freeFilter: boolean;
  isFree: (id: string, meta?: ModelsDevModel) => boolean;
  classifyProbe: (status: number, body: string) => ProbeClassification;
}

const nvidiaFree = () => true;
const zeroCostFree = (id: string, meta?: ModelsDevModel): boolean =>
  /(?:-free|:free)$/i.test(id) || (meta?.cost?.input === 0 && meta.cost.output === 0);
const openrouterFree = (id: string, meta?: ModelsDevModel): boolean =>
  /:free$/i.test(id) || (meta?.cost?.input === 0 && meta.cost.output === 0);

export const NVIDIA_PROFILE: ProviderProfile = {
  name: "nvidia",
  providerId: "nvidia-nim",
  label: "NVIDIA NIM",
  catalogId: "nvidia",
  baseURL: "https://integrate.api.nvidia.com/v1",
  envKeys: ["NVIDIA_API_KEY"],
  initApiKeyEnv: "NVIDIA_API_KEY",
  keyExample: "nvapi-...",
  dedicatedKeyPrefix: "NVIDIA_KEY_",
  marker: " ·NIM",
  providerUrlPattern: /nvidia/i,
  hasSite: true,
  probeAccountConfigured: false,
  probeAccountCandidates: false,
  defaultEffortValues: ["low", "high", "max"],
  tier: "free",
  tierLabel: "grátis (trial NVIDIA)",
  getKeyUrl: "https://build.nvidia.com",
  configPackage: "aisdk:@ai-sdk/openai-compatible",
  configBaseURL: true,
  initialLabel: "NVIDIA (selecionados)",
  probeDirect: false,
  freeFilter: false,
  isFree: nvidiaFree,
  classifyProbe: (status) => (status === 404 || status === 410 ? "gone" : null),
};

export const AIHUBMIX_PROFILE: ProviderProfile = {
  name: "aihubmix",
  providerId: "aihubmix",
  label: "AIHubMix",
  catalogId: "aihubmix",
  baseURL: "https://aihubmix.com/v1",
  backupBaseURL: "https://api.inferera.com/v1",
  envKeys: ["AIHUBMIX_API_KEY", "AIHUBMIX"],
  initApiKeyEnv: "AIHUBMIX_API_KEY",
  keyExample: "sk-...",
  dedicatedKeyPrefix: "AIHUBMIX_KEY_",
  marker: " ·MIX",
  providerUrlPattern: /aihubmix|inferera/i,
  hasSite: false,
  probeAccountConfigured: true,
  probeAccountCandidates: true,
  defaultEffortValues: [],
  tier: "freemium",
  tierLabel: "freemium (só -free/:free entra por padrão)",
  getKeyUrl: "https://aihubmix.com",
  configPackage: "aisdk:@ai-sdk/openai-compatible",
  configBaseURL: true,
  initialLabel: "AIHubMix (gratuitos)",
  probeDirect: true,
  freeFilter: true,
  isFree: zeroCostFree,
  classifyProbe: (status, body) => {
    if (status === 404 && /model_retired/i.test(body)) return "gone";
    if (status === 400 && /no_available_channel/i.test(body)) return "gone";
    if (status === 403 && /balance is insufficient|insufficient balance/i.test(body)) return "alive-paid";
    return null;
  },
};

export const GOOGLE_PROFILE: ProviderProfile = {
  name: "google",
  providerId: "google",
  label: "Google AI Studio",
  catalogId: "google",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
  envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  initApiKeyEnv: "GOOGLE_API_KEY",
  keyExample: "AIza...",
  dedicatedKeyPrefix: "GOOGLE_KEY_",
  marker: " ·GEM",
  providerUrlPattern: /google|generativelanguage/i,
  hasSite: false,
  probeAccountConfigured: true,
  probeAccountCandidates: false, // listagem do AI Studio é confiável; economiza sondagens
  defaultEffortValues: ["low", "high"],
  tier: "free",
  tierLabel: "grátis (cota por conta no AI Studio)",
  getKeyUrl: "https://aistudio.google.com/apikey",
  configPackage: "aisdk:@ai-sdk/google",
  configBaseURL: false, // package nativo conhece o endpoint
  initialLabel: "Google AI Studio (grátis)",
  probeDirect: true,
  freeFilter: false, // todo o catálogo é elegível; a cota é por conta, não por modelo
  isFree: nvidiaFree,
  classifyProbe: (status) => {
    if (status === 404) return "gone";
    if (status === 429) return "alive-quota"; // cota do free tier — o modelo existe
    return null;
  },
};

export const GROQ_PROFILE: ProviderProfile = {
  name: "groq",
  providerId: "groq",
  label: "Groq",
  catalogId: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  envKeys: ["GROQ_API_KEY"],
  initApiKeyEnv: "GROQ_API_KEY",
  keyExample: "gsk_...",
  dedicatedKeyPrefix: "GROQ_KEY_",
  marker: " ·GROQ",
  providerUrlPattern: /groq/i,
  hasSite: false,
  probeAccountConfigured: true,
  probeAccountCandidates: false,
  defaultEffortValues: [],
  tier: "free",
  tierLabel: "grátis (cota por conta)",
  getKeyUrl: "https://console.groq.com/keys",
  configPackage: "aisdk:@ai-sdk/openai-compatible",
  configBaseURL: true,
  initialLabel: "Groq (grátis)",
  probeDirect: true,
  freeFilter: false,
  isFree: nvidiaFree,
  classifyProbe: (status) => {
    if (status === 404 || status === 410) return "gone";
    if (status === 429) return "alive-quota";
    return null;
  },
};

export const OPENROUTER_PROFILE: ProviderProfile = {
  name: "openrouter",
  providerId: "openrouter",
  label: "OpenRouter",
  catalogId: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  envKeys: ["OPENROUTER_API_KEY"],
  initApiKeyEnv: "OPENROUTER_API_KEY",
  keyExample: "sk-or-v1-...",
  dedicatedKeyPrefix: "OPENROUTER_KEY_",
  marker: " ·OR",
  providerUrlPattern: /openrouter/i,
  hasSite: false,
  probeAccountConfigured: true,
  probeAccountCandidates: true, // rotas :free podem estar fora do ar
  defaultEffortValues: [],
  tier: "freemium",
  tierLabel: "freemium (só :free entra por padrão)",
  getKeyUrl: "https://openrouter.ai/keys",
  configPackage: "aisdk:@openrouter/ai-sdk-provider",
  configBaseURL: false,
  initialLabel: "OpenRouter (:free)",
  probeDirect: true,
  freeFilter: true,
  isFree: openrouterFree,
  classifyProbe: (status, body) => {
    if (status === 404) return "gone";
    if (status === 402) return "alive-paid";
    if (status === 403 && /insufficient|credit/i.test(body)) return "alive-paid";
    if (status === 429) return "alive-quota";
    return null;
  },
};

export const PROFILES: Record<Exclude<ProfileName, "custom">, ProviderProfile> = {
  nvidia: NVIDIA_PROFILE,
  google: GOOGLE_PROFILE,
  groq: GROQ_PROFILE,
  openrouter: OPENROUTER_PROFILE,
  aihubmix: AIHUBMIX_PROFILE,
};

/** Perfis construídos, ordenados pela filosofia grátis primeiro. */
export function allProfiles(): ProviderProfile[] {
  return [NVIDIA_PROFILE, GOOGLE_PROFILE, GROQ_PROFILE, OPENROUTER_PROFILE, AIHUBMIX_PROFILE];
}

const TIER_ORDER: Record<Tier, number> = { free: 0, freemium: 1, paid: 2, local: 3 };

export function tierOrder(tier: Tier): number {
  return TIER_ORDER[tier];
}

export function isProfileName(value: string): value is ProfileName {
  return value === "nvidia" || value === "aihubmix" || value === "google" || value === "groq" || value === "openrouter" || value === "custom";
}

export function getProfile(name: ProfileName = "nvidia"): ProviderProfile {
  if (name === "custom") throw new Error('perfil "custom" é construído em runtime (init --profile custom --base-url ...)');
  return PROFILES[name];
}

/** --provider <id> também seleciona o perfil, sem exigir --profile redundante. */
export function inferProfile(providerId?: string, explicit?: ProfileName): ProviderProfile {
  if (explicit && explicit !== "custom") return getProfile(explicit);
  if (providerId) {
    for (const p of allProfiles()) {
      if (p.providerId === providerId || p.providerUrlPattern.test(providerId)) return p;
    }
  }
  return NVIDIA_PROFILE;
}

// ---------- perfis custom (qualquer endpoint OpenAI-compatible) ----------

/** Definição persistida de um perfil custom (criado via `init --profile custom`). */
export interface CustomProfileDef {
  providerId: string;
  label: string;
  baseURL: string;
  envKeys: string[];
  initApiKeyEnv: string;
  keyExample: string;
  marker: string;
  tier: Tier;
  catalogId?: string; // lookup no models.dev por id (best-effort)
  createdAt: string;
  version: string;
}

/** Constrói um ProviderProfile de runtime a partir da definição persistida. */
export function customProfileFromDef(def: CustomProfileDef): ProviderProfile {
  const freemium = def.tier === "freemium";
  return {
    name: "custom",
    providerId: def.providerId,
    label: def.label,
    catalogId: def.catalogId ?? def.providerId,
    baseURL: def.baseURL,
    envKeys: def.envKeys,
    initApiKeyEnv: def.initApiKeyEnv,
    keyExample: def.keyExample,
    dedicatedKeyPrefix: `${def.providerId.toUpperCase().replace(/-/g, "_")}_KEY_`,
    marker: def.marker,
    providerUrlPattern: new RegExp(def.providerId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"),
    hasSite: false,
    probeAccountConfigured: true,
    probeAccountCandidates: true,
    defaultEffortValues: [],
    tier: def.tier,
    tierLabel: def.tier === "freemium" ? "freemium (custom)" : def.tier === "paid" ? "pago (custom)" : String(def.tier),
    configPackage: "aisdk:@ai-sdk/openai-compatible",
    configBaseURL: true,
    initialLabel: def.label,
    probeDirect: true,
    freeFilter: freemium,
    isFree: freemium ? zeroCostFree : nvidiaFree,
    classifyProbe: (status, body) => {
      if (status === 404) return "gone";
      if (status === 402) return "alive-paid";
      if (status === 403 && /insufficient|balance|credit/i.test(body)) return "alive-paid";
      if (status === 429) return "alive-quota";
      return null;
    },
  };
}
