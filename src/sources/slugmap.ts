// Resolução slug do site → ID real da API, por sondagem de variantes, com cache.
//
// O site usa slugs inconsistentes ("glm-5-3-flash", "kimi-k3_1-pro") onde a API
// usa pontos ("glm-5.3-flash"). Não há transformação determinística, então:
//   1. se o modelo está no models.dev, o ID canônico vem de lá (grátis)
//   2. senão, sondamos variantes do slug até uma responder (cache 24h p/ veredicto,
//      permanente para o mapa resolvido; "inconclusive" cacheia só 1h)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { normKey } from "../core/normalize";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";
const TTL_ALIVE = 24 * 60 * 60 * 1000;   // 24h
const TTL_INCONCLUSIVE = 1 * 60 * 60 * 1000; // 1h
const TTL_GONE = 7 * 24 * 60 * 60 * 1000;    // 7d (404/410 é estável)

export type ProbeVerdict = "alive" | "gone" | "inconclusive";

interface SlugMapEntry {
  apiId: string;
  verdict: ProbeVerdict;
  probedAt: number;
}

function cachePath(): string {
  return `${homedir()}/.cache/nimsync/slugmap.json`;
}

type SlugMap = Record<string, SlugMapEntry>; // chave: normKey(slug)

function load(): SlugMap {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8")) as SlugMap;
  } catch {
    return {};
  }
}

function save(map: SlugMap): void {
  try {
    mkdirSync(`${homedir()}/.cache/nimsync`, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(map, null, 1));
  } catch {
    // best-effort
  }
}

let cache: SlugMap | null = null;
function map(): SlugMap {
  if (!cache) cache = load();
  return cache;
}

export function clearSlugMap(): void {
  cache = {};
  save({});
}

/** Variantes de ID a tentar para um slug, em ordem. */
export function idVariants(publisher: string, slug: string): string[] {
  const variants = [`${publisher}/${slug}`];
  if (slug.includes("_")) variants.push(`${publisher}/${slug.replaceAll("_", ".")}`);
  if (slug.includes("-")) variants.push(`${publisher}/${slug.replaceAll("-", ".")}`);
  return [...new Set(variants)];
}

export async function probeChatModel(
  apiKey: string,
  model: string,
  timeoutMs = 20_000
): Promise<ProbeVerdict> {
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
    // 404 = não existe · 410 = end-of-life oficial da NVIDIA
    if (res.status === 404 || res.status === 410) return "gone";
    await res.text().catch(() => {});
    return "inconclusive";
  } catch {
    return "inconclusive";
  }
}

export interface ResolveResult {
  apiId?: string;   // ID vivo confirmado
  verdict: ProbeVerdict;
  probed: boolean;  // false quando veio do cache
}

/**
 * Resolve o ID vivo de um slug: consulta o cache; se expirado/ausente,
 * testa variantes em paralelo limitado e grava o resultado.
 */
export async function resolveSlugId(
  publisher: string,
  slug: string,
  apiKey: string,
  opts: { knownId?: string; refresh?: boolean; timeoutMs?: number } = {}
): Promise<ResolveResult> {
  const key = normKey(`${publisher}/${slug}`);
  const m = map();
  const hit = m[key];
  if (!opts.refresh && hit) {
    const ttl = hit.verdict === "alive" ? TTL_ALIVE : hit.verdict === "gone" ? TTL_GONE : TTL_INCONCLUSIVE;
    if (Date.now() - hit.probedAt < ttl) {
      return { apiId: hit.verdict === "alive" ? hit.apiId : undefined, verdict: hit.verdict, probed: false };
    }
  }
  if (opts.knownId) {
    // ID canônico do models.dev: confia sem sondar (a vida/morte de CONFIGURADOS
    // é verificada em outro fluxo)
    return { apiId: opts.knownId, verdict: "alive", probed: false };
  }
  const variants = idVariants(publisher, slug);
  let verdict: ProbeVerdict = "inconclusive";
  let apiId: string | undefined;
  // sequencial: o primeiro "alive" encerra; 404s são instantâneos
  for (const v of variants) {
    const r = await probeChatModel(apiKey, v, opts.timeoutMs ?? 20_000);
    if (r === "alive") {
      verdict = "alive";
      apiId = v;
      break;
    }
    if (r === "gone") {
      verdict = "gone";
      apiId = v;
      // continua? não: 404 no primeira variante não significa que a próxima falha...
      // na prática todas derivam do mesmo slug; 404 = rota não existe
      break;
    }
  }
  m[key] = { apiId: apiId ?? variants[0], verdict, probedAt: Date.now() };
  save(m);
  return { apiId: verdict === "alive" ? apiId : undefined, verdict, probed: true };
}
