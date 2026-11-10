// Fonte 2 (metadados): models.dev — a mesma fonte do catálogo do OpenCode.
// Fornece limites (context/output), custo, tool_call, reasoning_options (valores
// exatos de reasoning_effort por modelo!) e status (deprecated/beta/...).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ModelsDevModel } from "../types";

const API_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function cachePath(): string {
  return `${homedir()}/.cache/nimsync/modelsdev.json`;
}

interface CacheEntry {
  fetchedAt: number;
  // guardamos só o provider nvidia (o api.json inteiro tem ~6MB)
  nvidia: Record<string, ModelsDevModel>;
}

async function fetchFresh(): Promise<Record<string, ModelsDevModel>> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`models.dev -> HTTP ${res.status}`);
  const all = (await res.json()) as Record<string, { models?: Record<string, ModelsDevModel> }>;
  const nvidia = all["nvidia"]?.models ?? {};
  // persistir cache — só se veio conteúdo (nunca cachear vazio)
  if (Object.keys(nvidia).length > 0) {
    try {
      mkdirSync(`${homedir()}/.cache/nimsync`, { recursive: true });
      const entry: CacheEntry = { fetchedAt: Date.now(), nvidia };
      await Bun.write(cachePath(), JSON.stringify(entry));
    } catch {
      // cache é best-effort
    }
  }
  return nvidia;
}

export async function fetchModelsDev(refresh = false): Promise<Record<string, ModelsDevModel>> {
  if (!refresh) {
    try {
      const file = Bun.file(cachePath());
      const cached = (await file.json()) as CacheEntry;
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.nvidia) {
        return cached.nvidia;
      }
    } catch {
      // sem cache: busca
    }
  }
  return fetchFresh();
}

/** Heurística "é modelo de chat utilizável em agente de código": tool_call ou reasoning. */
export function isChatModel(m: ModelsDevModel): boolean {
  return Boolean(m.tool_call || m.reasoning);
}
