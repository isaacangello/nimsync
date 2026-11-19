// Fonte 1: GET /v1/models na API OpenAI-compatible com a chave da conta.
// A listagem é uma fonte de descoberta; a sondagem continua sendo o veredito.

import { NVIDIA_PROFILE, type ProviderProfile } from "../core/profile";

const NIM_BASE = NVIDIA_PROFILE.baseURL;

export async function fetchAccountModels(
  apiKey: string,
  timeoutMs = 30_000,
  baseURL = NIM_BASE
): Promise<string[]> {
  const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/models -> HTTP ${res.status} (chave inválida ou API indisponível)`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string");
  return ids.sort();
}

/**
 * Sondagem mínima. Respostas inconclusivas (timeout/rede/fila/saldo desconhecido)
 * nunca autorizam remoção. A classificação de morte/saldo pertence ao perfil.
 */
export async function probeChatModel(
  apiKey: string,
  model: string,
  timeoutMs = 30_000,
  baseURL = NIM_BASE,
  profile: ProviderProfile = NVIDIA_PROFILE
): Promise<"alive" | "alive-paid" | "gone" | "inconclusive"> {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      await res.text().catch(() => {});
      return "alive";
    }
    const body = await res.text().catch(() => "");
    return profile.classifyProbe(res.status, body) ?? "inconclusive";
  } catch {
    return "inconclusive";
  }
}
