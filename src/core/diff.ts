// O coração (v2): descoberta = UNIÃO das fontes; veredito = SONDAGEM.
//
// Lições incorporadas:
//   - /v1/models NÃO é autoritativo (omitia glm-5.3 vivo; não lista kimi-k3_1-pro)
//   - badge "Free Endpoint" do site pode mentir (kimi-k3_1-pro: 404 no trial)
//   - logo: todo candidato novo com Free Endpoint é sondado; 404/410 = morto,
//     200 = pronto, timeout = inconclusivo (mostrado, nunca agido)
//   - modelos CONFIGURADOS sempre aparecem no relatório, mesmo que tenham
//     sumido de todas as fontes (fantasmas) — e são sondados para definir
//     vivo × morto

import { normKey } from "./normalize";
import type { ModelRow, ModelsDevModel, Report, SiteModel } from "../types";
import { resolveSlugId } from "../sources/slugmap";

export interface ReportInputs {
  configured: string[];
  account: string[];
  meta: Record<string, ModelsDevModel>;
  siteCards: SiteModel[];
  apiKey: string;
  refresh?: boolean;
  noProbe?: boolean;
  timeoutMs?: number;
}

const metaByNorm = (meta: Record<string, ModelsDevModel>): Map<string, ModelsDevModel> => {
  const m = new Map<string, ModelsDevModel>();
  for (const [id, v] of Object.entries(meta)) m.set(normKey(id), v);
  return m;
};

const isChat = (m?: ModelsDevModel): boolean => Boolean(m?.tool_call || m?.reasoning);

/** Heurística pela descrição do card (para modelos sem catálogo no models.dev). */
function looksNonChat(text?: string): boolean {
  if (!text) return false;
  return /(text-to-speech|tts|speech|audio|voice|embedding|retrieval|rerank|ocr|object detection|3d object|video|image generation|pose|driving|detector|moderation|translation|safety model|guard)/i.test(
    text
  );
}

export async function computeReport(inputs: ReportInputs): Promise<Report> {
  const meta = metaByNorm(inputs.meta);
  const accountSet = new Set(inputs.account.map(normKey));
  const cfgSet = new Set(inputs.configured.map(normKey));
  const cfgIdByNorm = new Map(inputs.configured.map((id) => [normKey(id), id] as const));

  const siteByNorm = new Map<string, SiteModel>();
  for (const c of inputs.siteCards) siteByNorm.set(normKey(`${c.publisher}/${c.slug}`), c);

  const rows = new Map<string, ModelRow>(); // normKey -> row (dedupe)

  const originOf = (hasSite: boolean, hasMd: boolean): ModelRow["origin"] =>
    hasSite && hasMd ? "site+md" : hasSite ? "site" : hasMd ? "md" : "account";

  // ---------- 1) universo do SITE (fonte primária de descoberta)
  for (const card of inputs.siteCards) {
    const key = normKey(`${card.publisher}/${card.slug}`);
    const m = meta.get(key);
    const configured = cfgSet.has(key);
    const base: ModelRow = {
      id: cfgIdByNorm.get(key) ?? m?.id ?? `${card.publisher}/${card.slug}`,
      name: m?.name ?? card.name,
      origin: originOf(true, Boolean(m)),
      configured,
      status: "unverified",
      freeEndpoint: Boolean(card.freeEndpoint),
      deprecationDays: card.deprecationDays,
      deprecationSource: card.deprecationDays != null ? "site" : undefined,
      description: card.description,
      meta: m,
      url: card.url,
    };

    if (!card.freeEndpoint) {
      // configurado sem Free Endpoint? segue para a sondagem (pode estar vivo)
      base.status = configured ? "inconclusive" : "notfree";
      if (!configured) base.note = "sem badge Free Endpoint (container/download) — não entra na config";
      rows.set(key, base);
      continue;
    }

    if (configured) {
      // vida dos configurados: está na conta? deprecando?
      if (!accountSet.has(key)) {
        base.status = "inconclusive"; // sondagem decide (lote 4a)
        base.note = "aguardando sondagem (fora do /v1/models)";
      } else {
        base.status = "alive";
        if (card.deprecationDays != null) {
          base.status = "deprecating";
        } else if (m?.status === "deprecated") {
          base.status = "deprecating";
          base.deprecationSource = "modelsdev";
        }
      }
      rows.set(key, base);
      continue;
    }

    // não configurado + Free Endpoint: candidato novo — sondagem decide
    base.status = "unverified";
    rows.set(key, base);
  }

  // ---------- 2) conta sem card no site
  for (const id of inputs.account) {
    const key = normKey(id);
    if (rows.has(key)) continue;
    const m = meta.get(key);
    const configured = cfgSet.has(key);
    const row: ModelRow = {
      id,
      name: m?.name,
      origin: m ? "md" : "account",
      configured,
      status: "unverified",
      meta: m,
    };
    if (!m) {
      row.status = "nonchat";
      row.note = "na sua conta, sem metadados (provavelmente embedding/rerank/visão)";
      rows.set(key, row);
    } else {
      row.status = configured ? "alive" : "unverified";
      row.note = configured ? undefined : "no models.dev, sem card no site — sonda antes de usar";
      rows.set(key, row);
    }
  }

  // ---------- 3) models.dev sem card e sem presença na conta
  for (const [id, m] of Object.entries(inputs.meta)) {
    const key = normKey(id);
    if (rows.has(key)) continue;
    rows.set(key, {
      id,
      name: m.name,
      origin: "md",
      configured: cfgSet.has(key),
      status: "unverified",
      meta: m,
      note: "só no models.dev — sem card no site e fora do /v1/models",
    });
  }

  // ---------- 4) FANTASMAS: configurados que não aparecem em nenhuma fonte
  for (const id of inputs.configured) {
    const key = normKey(id);
    if (rows.has(key)) continue;
    rows.set(key, {
      id,
      origin: "account",
      configured: true,
      status: "inconclusive", // sondagem decide
      note: "na config, mas sumiu de site, conta e models.dev — aguardando sondagem",
    });
  }

  // ---------- 5) sondagens (concurrencia 4)
  let probes = 0;
  if (!inputs.noProbe) {
    const queue: Array<() => Promise<void>> = [];

    // 5a. TODOS os configurados em dúvida + fantasma: sondar
    for (const row of rows.values()) {
      if (row.configured && (row.status === "inconclusive" || row.status === "unverified")) {
        queue.push(async () => {
          probes++;
          const s = slugOf(row.id);
          const r = await resolveSlugId(s.publisher, s.slug, inputs.apiKey, {
            knownId: accountSet.has(normKey(row.id)) ? row.id : undefined,
            refresh: inputs.refresh,
            timeoutMs: inputs.timeoutMs,
          });
          if (r.verdict === "alive") {
            row.status = row.deprecationDays != null ? "deprecating" : "alive";
            if (row.note?.includes("sondagem")) row.note = undefined;
            if (r.verdict === "alive" && !accountSet.has(normKey(row.id)) && row.status === "alive") {
              row.status = "deprecating";
              row.note = "fora do /v1/models mas AINDA RESPONDE (sunset) — remova só quando parar";
            }
          } else if (r.verdict === "gone") {
            row.status = "dead";
            row.note = "sondagem confirmou o fim (HTTP 410 Gone / 404)";
          } else {
            row.status = "deprecating";
            row.note = "sondagem inconclusiva (fila/thinking) — NÃO removido automaticamente";
          }
        });
      }
    }

    // 5b. novos candidatos com Free Endpoint (fora da conta) — sondar + filtrar chat
    for (const row of rows.values()) {
      if (!row.configured && row.freeEndpoint && row.status === "unverified") {
        queue.push(async () => {
          if (accountSet.has(normKey(row.id))) {
            markChatWorthiness(row);
            if (row.status === "unverified") row.status = "new-ready";
            return;
          }
          probes++;
          const s = slugOf(row.id);
          const r = await resolveSlugId(s.publisher, s.slug, inputs.apiKey, {
            knownId: row.meta?.id,
            refresh: inputs.refresh,
            timeoutMs: inputs.timeoutMs,
          });
          if (r.verdict === "alive") {
            if (r.apiId && normKey(r.apiId) !== normKey(row.id)) row.apiId = r.apiId;
            markChatWorthiness(row);
            if (row.status === "unverified") row.status = "new-ready";
          } else if (r.verdict === "gone") {
            row.status = "dead";
            row.note = "badge Free Endpoint, mas o endpoint responde 404/410 — não utilizável (ainda)";
          } else {
            row.status = "inconclusive";
            row.note = "sondagem inconclusiva (fila/rede) — rode de novo mais tarde";
          }
        });
      }
    }

    const workers = Array.from({ length: 4 }, async () => {
      for (;;) {
        const task = queue.shift();
        if (!task) return;
        await task();
      }
    });
    await Promise.all(workers);
  }

  // ---------- 6) distribui nas 4 seções
  const report: Report = {
    freeEndpoint: [],
    noFreeEndpoint: [],
    modelsdevOnly: [],
    rest: [],
    stats: {
      probes,
      accountCount: inputs.account.length,
      metaCount: Object.keys(inputs.meta).length,
      siteCount: inputs.siteCards.length,
    },
  };
  const order = {
    "new-ready": 0,
    alive: 1,
    deprecating: 2,
    dead: 3,
    inconclusive: 4,
    unverified: 5,
    notfree: 6,
    nonchat: 7,
  } as const;
  for (const row of rows.values()) {
    if (row.status === "nonchat") {
      report.rest.push(row);
    } else if (row.configured) {
      // configurados SEMPRE na seção 1 — é o conjunto ativo do usuário
      report.freeEndpoint.push(row);
    } else if (row.freeEndpoint) {
      report.freeEndpoint.push(row);
    } else if (row.status === "notfree") {
      report.noFreeEndpoint.push(row);
    } else if (row.origin === "md") {
      report.modelsdevOnly.push(row);
    } else {
      report.rest.push(row);
    }
  }
  const byOrder = (a: ModelRow, b: ModelRow) => order[a.status] - order[b.status] || a.id.localeCompare(b.id);
  report.freeEndpoint.sort(byOrder);
  report.noFreeEndpoint.sort(byOrder);
  report.modelsdevOnly.sort(byOrder);
  report.rest.sort(byOrder);
  return report;
}

/** candidato vivo: só vira "new-ready" se parecer chat; senão vai pro resto */
function markChatWorthiness(row: ModelRow): void {
  if (row.meta) {
    if (!isChat(row.meta)) {
      row.status = "nonchat";
      row.note = "existe e responde, mas sem tool_call/reasoning no models.dev (não é chat)";
    }
    return;
  }
  if (looksNonChat(row.description)) {
    row.status = "nonchat";
    row.note = "responde, mas a descrição indica não-chat (TTS/embedding/visão…)";
  }
  // sem meta e descrição ambígua: mantém como candidato (o usuário decide)
}

/** separa "publisher/slug" tolerando IDs com pontos */
function slugOf(id: string): { publisher: string; slug: string } {
  const [publisher, ...rest] = id.split("/");
  return { publisher, slug: rest.join("/") };
}

/** Valores de reasoning_effort para as variants, a partir do models.dev. */
export function effortValues(m?: ModelsDevModel): string[] {
  const opts = m?.reasoning_options?.find((o) => o.type === "effort")?.values;
  if (opts?.length) return opts;
  if (m?.reasoning) return ["low", "high", "max"]; // padrão seguro dos NIM
  return [];
}
