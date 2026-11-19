// Fonte 2 (metadados): models.dev — a mesma fonte do catálogo do OpenCode.
// Fornece limites (context/output), custo, tool_call, reasoning_options (valores
// exatos de reasoning_effort por modelo!) e status (deprecated/beta/...).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ModelsDevModel } from "../types";

const API_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

type CatalogId = "nvidia" | "aihubmix";

function cachePath(catalogId: CatalogId): string {
  // Mantém o arquivo NVIDIA legado; catálogos novos têm cache independente.
  const suffix = catalogId === "nvidia" ? "" : `-${catalogId}`;
  return `${homedir()}/.cache/nimsync/modelsdev${suffix}.json`;
}

interface CacheEntry {
  fetchedAt: number;
  models?: Record<string, ModelsDevModel>;
  nvidia?: Record<string, ModelsDevModel>; // formato legado <= 0.3.x
  aihubmix?: Record<string, ModelsDevModel>;
}

async function fetchFresh(catalogId: CatalogId): Promise<Record<string, ModelsDevModel>> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`models.dev -> HTTP ${res.status}`);
  const all = (await res.json()) as Record<string, { models?: Record<string, ModelsDevModel> }>;
  const models = all[catalogId]?.models ?? {};
  // persistir cache — só se veio conteúdo (nunca cachear vazio)
  if (Object.keys(models).length > 0) {
    try {
      mkdirSync(`${homedir()}/.cache/nimsync`, { recursive: true });
      const entry: CacheEntry = { fetchedAt: Date.now(), models };
      await Bun.write(cachePath(catalogId), JSON.stringify(entry));
    } catch {
      // cache é best-effort
    }
  }
  return models;
}

export async function fetchModelsDev(
  refresh = false,
  catalogId: CatalogId = "nvidia"
): Promise<Record<string, ModelsDevModel>> {
  if (!refresh) {
    try {
      const file = Bun.file(cachePath(catalogId));
      const cached = (await file.json()) as CacheEntry;
      const models = cached.models ?? cached[catalogId];
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && models) return models;
    } catch {
      // sem cache: busca
    }
  }
  return fetchFresh(catalogId);
}

/** Heurística "é modelo de chat utilizável em agente de código": tool_call ou reasoning. */
export function isChatModel(m: ModelsDevModel): boolean {
  return Boolean(m.tool_call || m.reasoning);
}
