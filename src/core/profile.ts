// Perfis dos providers OpenAI-compatible suportados pelo nimsync.
// O perfil NVIDIA é o default para preservar a interface e o comportamento anteriores.

import type { ModelsDevModel } from "../types";

export type ProfileName = "nvidia" | "aihubmix";
export type ProbeClassification = "gone" | "alive-paid" | null;

export interface ProviderProfile {
  name: ProfileName;
  providerId: string;
  label: string;
  catalogId: "nvidia" | "aihubmix";
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
  isFree: (id: string, meta?: ModelsDevModel) => boolean;
  classifyProbe: (status: number, body: string) => ProbeClassification;
}

const nvidiaFree = () => true;
const aiHubMixFree: ProviderProfile["isFree"] = (id, meta) =>
  /(?:-free|:free)$/i.test(id) || (meta?.cost?.input === 0 && meta.cost.output === 0);

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
  initApiKeyEnv: "AIHUBMIX",
  keyExample: "sk-...",
  dedicatedKeyPrefix: "AIHUBMIX_KEY_",
  marker: " ·MIX",
  providerUrlPattern: /aihubmix|inferera/i,
  hasSite: false,
  probeAccountConfigured: true,
  probeAccountCandidates: true,
  defaultEffortValues: [],
  isFree: aiHubMixFree,
  classifyProbe: (status, body) => {
    if (status === 404 && /model_retired/i.test(body)) return "gone";
    if (status === 400 && /no_available_channel/i.test(body)) return "gone";
    if (status === 403 && /balance is insufficient|insufficient balance/i.test(body)) return "alive-paid";
    return null;
  },
};

export const PROFILES: Record<ProfileName, ProviderProfile> = {
  nvidia: NVIDIA_PROFILE,
  aihubmix: AIHUBMIX_PROFILE,
};

export function isProfileName(value: string): value is ProfileName {
  return value === "nvidia" || value === "aihubmix";
}

export function getProfile(name: ProfileName = "nvidia"): ProviderProfile {
  return PROFILES[name];
}

/** --provider aihubmix também seleciona o perfil, sem exigir --profile redundante. */
export function inferProfile(providerId?: string, explicit?: ProfileName): ProviderProfile {
  if (explicit) return getProfile(explicit);
  if (providerId && AIHUBMIX_PROFILE.providerUrlPattern.test(providerId)) return AIHUBMIX_PROFILE;
  return NVIDIA_PROFILE;
}
