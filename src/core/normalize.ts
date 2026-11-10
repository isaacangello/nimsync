// Normalização de IDs: slugs do site usam traços/underscores, IDs da API usam pontos.
// "z-ai/glm-5-3-flash" (site) ≡ "z-ai/glm-5.3-flash" (API) ≡ "z-ai/glm5_3-flash"?
// Chave canônica: lowercase + remoção de [-._] em cada segmento -> sempre comparável.

export function normKey(id: string): string {
  return id
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[-._]/g, ""))
    .join("/");
}

/** Sugerir nome de env var dedicada a partir do modelID: "z-ai/glm-5.3-flash" -> NVIDIA_KEY_Z_AI_GLM_5_3_FLASH */
export function envNameForModel(id: string): string {
  return (
    "NVIDIA_KEY_" +
    id
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}
