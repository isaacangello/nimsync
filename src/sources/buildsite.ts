// Fonte 3 (deprecação): listagem build.nvidia.com/models?page=N
//
// O site varia a resposta conforme o browser/UA (o usuário observa comportamentos
// estranhos fora do Chrome), então este scraper é defensivo em três camadas:
//   1. parse do HTML SSR com regex tolerante (h3 com ou sem atributos)
//   2. retry com UA alternativo (Firefox -> Chrome) quando a página não parseia
//   3. fallback: extração de slugs direto do payload RSC (self.__next_f), que
//      existe independente do SSR — perde apenas os badges, nunca a lista
// E NUNCA cacheia resultado vazio (evita venenar o cache por 6h).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { normKey } from "../core/normalize";
import type { SiteModel } from "../types";

const UA_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
const UA_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_PAGES = 10;
const RESERVED = new Set(["models", "search", "about", "docs", "blog", "login", "signup", "account"]);

function cachePath(): string {
  return `${homedir()}/.cache/nimsync/site.json`;
}

// --- parsers -------------------------------------------------------------

const H3_RE = /<h3[^>]*>\s*<a[^>]*?href="\/([^"<>]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
const BADGE_RE = />Deprecation in (\d+)d</g;
const DESC_RE = /<span[^>]*line-clamp-2[^>]*>([\s\S]*?)<\/span>/;

function parseCards(html: string): SiteModel[] {
  const h3s: Array<{ index: number; path: string; name: string }> = [];
  for (const m of html.matchAll(H3_RE)) {
    const path = m[1];
    if (!path.includes("/")) continue;
    const [publisher, slug] = path.split("/");
    if (!publisher || !slug || RESERVED.has(publisher)) continue;
    const name = m[2].replace(/<[^>]+>/g, "").trim();
    h3s.push({ index: m.index, path, name });
  }
  const badges: Array<{ index: number; days: number }> = [];
  for (const m of html.matchAll(BADGE_RE)) {
    badges.push({ index: m.index, days: Number(m[1]) });
  }

  const cards: SiteModel[] = [];
  for (let i = 0; i < h3s.length; i++) {
    const h3 = h3s[i];
    const prevIndex = i === 0 ? -1 : h3s[i - 1].index;
    // janela ANTES do h3: cabeçalho do card (publisher + badges)
    const beforeStart = prevIndex < 0 ? Math.max(0, h3.index - 1200) : prevIndex;
    const before = html.slice(beforeStart, h3.index);
    const own = badges.filter((b) => b.index > beforeStart && b.index < h3.index).pop();
    // descrição: span "line-clamp-2" logo APÓS o </h3> do card
    const after = html.slice(h3.index, i + 1 < h3s.length ? h3s[i + 1].index : h3.index + 3000);
    const descMatch = after.match(DESC_RE);
    const [publisher, slug] = h3.path.split("/");
    if (!publisher || !slug) continue;
    cards.push({
      publisher,
      slug,
      url: `https://build.nvidia.com/${h3.path}`,
      name: h3.name || undefined,
      description: descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() || undefined : undefined,
      freeEndpoint: before.includes("Free Endpoint"),
      downloadable: before.includes("Downloadable"),
      deprecationDays: own?.days,
    });
  }
  return cards;
}

/** Fallback: desescapa o payload RSC e extrai pares publisher/slug (sem badges). */
function parseFromRsc(html: string): SiteModel[] {
  const unescaped = html.replaceAll('\\"', '"').replaceAll("\\/", "/");
  const seen = new Map<string, SiteModel>();
  const re = /href="\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)"/gi;
  for (const m of unescaped.matchAll(re)) {
    const [, publisher, slug] = m;
    if (RESERVED.has(publisher.toLowerCase())) continue;
    const url = `https://build.nvidia.com/${publisher}/${slug}`;
    if (!seen.has(url)) seen.set(url, { publisher, slug, url });
  }
  return [...seen.values()];
}

// --- rede ----------------------------------------------------------------

async function fetchRaw(page: number, ua: string): Promise<string> {
  const res = await fetch(`https://build.nvidia.com/models?page=${page}`, {
    headers: { "User-Agent": ua, Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`build.nvidia.com/models?page=${page} -> HTTP ${res.status}`);
  return res.text();
}

/** Busca uma página tentando Firefox e, se não parsear, Chrome; por último RSC. */
async function fetchPage(page: number): Promise<SiteModel[]> {
  const html = await fetchRaw(page, UA_FIREFOX);
  const cards = parseCards(html);
  if (cards.length > 0) return cards;
  const html2 = await fetchRaw(page, UA_CHROME);
  const cards2 = parseCards(html2);
  if (cards2.length > 0) return cards2;
  return parseFromRsc(html2.length >= html.length ? html2 : html);
}

async function fetchFresh(): Promise<{ cards: SiteModel[]; degraded: boolean }> {
  const all = new Map<string, SiteModel>();
  let degraded = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const cards = await fetchPage(page);
    let novos = 0;
    for (const c of cards) {
      if (!all.has(c.url)) {
        all.set(c.url, c);
        novos++;
      }
    }
    if (novos === 0) break; // página repetida/sem cards: fim da listagem
  }
  // degradação: se algum card veio só do fallback RSC, ele não tem badge/nome
  degraded = [...all.values()].some((c) => c.name === undefined && c.deprecationDays === undefined);
  const cards = [...all.values()].sort((a, b) => a.url.localeCompare(b.url));
  if (cards.length > 0) {
    try {
      mkdirSync(`${homedir()}/.cache/nimsync`, { recursive: true });
      await Bun.write(cachePath(), JSON.stringify({ fetchedAt: Date.now(), cards, degraded }));
    } catch {
      // cache best-effort
    }
  }
  return { cards, degraded };
}

export async function fetchSiteCards(
  refresh = false
): Promise<{ cards: SiteModel[]; degraded: boolean }> {
  if (!refresh) {
    try {
      const cached = (await Bun.file(cachePath()).json()) as {
        fetchedAt: number;
        cards: SiteModel[];
        degraded?: boolean;
      };
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && Array.isArray(cached.cards)) {
        return { cards: cached.cards, degraded: Boolean(cached.degraded) };
      }
    } catch {
      // sem cache: busca
    }
  }
  return fetchFresh();
}

/** Mapa normKey("publisher/slug") -> card, para casar com modelIDs da API. */
export function siteIndex(cards: SiteModel[]): Map<string, SiteModel> {
  const map = new Map<string, SiteModel>();
  for (const c of cards) map.set(normKey(`${c.publisher}/${c.slug}`), c);
  return map;
}
