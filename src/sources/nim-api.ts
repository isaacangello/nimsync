// Fonte 1 (autoritativa): GET /v1/models na API do NIM com a chave da conta.
// Modelo fora desta lista = não disponível para a conta (morto/descontinuado).

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

export async function fetchAccountModels(apiKey: string, timeoutMs = 30_000): Promise<string[]> {
  const res = await fetch(`${NIM_BASE}/models`, {
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
 * Sondagem: o modelo ainda responde apesar de ter sumido do /v1/models?
 * Caso glm-5.3 (nov/2026): fora do catálogo mas servindo em sunset.
 * "inconclusive" (timeout/rede/fila) NUNCA deve remover nada.
 */
export async function probeChatModel(
  apiKey: string,
  model: string,
  timeoutMs = 30_000
): Promise<"alive" | "gone" | "inconclusive"> {
  try {
    const res = await fetch(`${NIM_BASE}/chat/completions`, {
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
    if (res.ok) return "alive";
    // 404 = modelo não existe · 410 = end-of-life oficial da NVIDIA (o doctor
    // mostrou: "reached its end of life") — ambos são mortes definitivas
    if (res.status === 404 || res.status === 410) return "gone";
    // drena o corpo para liberar a conexão
    await res.text().catch(() => {});
    return "inconclusive";
  } catch {
    return "inconclusive";
  }
}
