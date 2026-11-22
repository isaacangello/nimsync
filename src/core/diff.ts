// O coração (v2): descoberta = UNIÃO das fontes; veredito = SONDAGEM.
//
// Lições incorporadas:
//   - /v1/models NÃO é autoritativo (NVIDIA omite modelos vivos; AIHubMix lista aposentados)
//   - badge "Free Endpoint" do site pode mentir; ID "-free" também pode estar aposentado
//   - todo candidato elegível é sondado quando a conta não é confiável; timeout/rede
//     é inconclusivo (mostrado, nunca agido)
//   - modelos CONFIGURADOS sempre aparecem no relatório, mesmo que tenham sumido
//     de todas as fontes (fantasmas), e são sondados quando necessário
//   - PAGO é decisão do usuário: sem --include-paid, rotas pagas ficam fora da
//     whitelist; com ele, entram como candidatos explícitos ([$])

import { normKey } from "./normalize";
import { NVIDIA_PROFILE, type ProviderProfile } from "./profile";
import type { ModelRow, ModelsDevModel, Report, SiteModel } from "../types";
import { probeChatModel, resolveSlugId, type ResolveResult } from "../sources/slugmap";

export interface ReportInputs {
  configured: string[];
  account: string[];
  meta: Record<string, ModelsDevModel>;
  siteCards: SiteModel[];
  apiKey: string;
  profile?: ProviderProfile;
  refresh?: boolean;
  noProbe?: boolean;
  timeoutMs?: number;
  /** opt-in explícito: candidatos pagos (freemium) entram na whitelist */
  includePaid?: boolean;
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
  const profile = inputs.profile ?? NVIDIA_PROFILE;
  const meta = metaByNorm(inputs.meta);
  const accountSet = new Set(inputs.account.map(normKey));
  const cfgSet = new Set(inputs.configured.map(normKey));
  const cfgIdByNorm = new Map(inputs.configured.map((id) => [normKey(id), id] as const));

  const siteByNorm = new Map<string, SiteModel>();
  for (const c of inputs.siteCards) siteByNorm.set(normKey(`${c.publisher}/${c.slug}`), c);

  const rows = new Map<string, ModelRow>(); // normKey -> row (dedupe)

  const originOf = (hasSite: boolean, hasMd: boolean): ModelRow["origin"] =>
    hasSite && hasMd ? "site+md" : hasSite ? "site" : hasMd ? "md" : "account";

  // ---------- 1) universo do SITE (fonte primária de descoberta no NVIDIA)
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
      if (!accountSet.has(key)) {
        base.status = "inconclusive"; // sondagem decide (lote 5a)
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

    base.status = "unverified";
    rows.set(key, base);
  }

  // ---------- 2) conta sem card no site
  for (const id of inputs.account) {
    const key = normKey(id);
    if (rows.has(key)) continue;
    const m = meta.get(key);
    const configured = cfgSet.has(key);
    const free = profile.freeFilter ? profile.isFree(id, m) : undefined;
    const row: ModelRow = {
      id,
      name: m?.name,
      origin: m ? "md" : "account",
      configured,
      status: "unverified",
      freeEndpoint: free,
      meta: m,
    };

    if (profile.probeDirect) {
      // profiles sem site: listagem da conta não garante a rota
      if (configured) {
        if (profile.probeAccountConfigured) {
          row.status = "unverified";
          row.note = "aguardando sondagem (a listagem da conta não garante a rota)";
        } else {
          row.status = "alive";
        }
      } else if (profile.freeFilter && !free) {
        // freemium: pago por padrão; com --include-paid vira candidato explícito
        if (inputs.includePaid) {
          row.paidModel = true;
          row.freeEndpoint = true;
          row.note = "[$] pago — incluído por opt-in (--include-paid)";
        } else {
          row.status = "notfree";
          row.note = "modelo pago — listado na conta, mas fora da whitelist gratuita";
        }
      }
      // gratuito não configurado fica unverified e será sondado, conforme o perfil
    } else if (!m) {
      row.status = "nonchat";
      row.note = "na sua conta, sem metadados (provavelmente embedding/rerank/visão)";
    } else {
      row.status = configured ? "alive" : "unverified";
      row.note = configured ? undefined : "no models.dev, sem card no site — sonda antes de usar";
    }
    rows.set(key, row);
  }

  // ---------- 3) models.dev sem card e sem presença na conta
  for (const [id, m] of Object.entries(inputs.meta)) {
    const key = normKey(id);
    if (rows.has(key)) continue;
    const configured = cfgSet.has(key);
    const free = profile.freeFilter ? profile.isFree(id, m) : undefined;
    const isFreeProfile = profile.probeDirect && !profile.freeFilter; // google/groq: catálogo todo elegível
    rows.set(key, {
      id,
      name: m.name,
      origin: "md",
      configured,
      status:
        profile.freeFilter && !configured && !free
          ? inputs.includePaid
            ? "unverified"
            : "notfree"
          : "unverified",
      freeEndpoint: profile.freeFilter ? free : isFreeProfile ? true : undefined,
      paidModel: profile.freeFilter && !free && inputs.includePaid ? true : undefined,
      meta: m,
      note: profile.freeFilter
        ? free || configured
          ? "gratuito no models.dev, fora do /v1/models — aguardando sondagem"
          : "modelo pago no models.dev — fora da whitelist gratuita"
        : isFreeProfile
          ? "só no models.dev, fora da listagem da conta — sonda antes de usar"
          : "só no models.dev — sem card no site e fora do /v1/models",
    });
    if (profile.freeFilter && !free && inputs.includePaid) {
      const r = rows.get(key)!;
      r.freeEndpoint = true;
      r.note = "[$] pago — incluído por opt-in (--include-paid)";
    }
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
      freeEndpoint: profile.freeFilter ? profile.isFree(id) : undefined,
      note: "na config, mas sumiu de site, conta e models.dev — aguardando sondagem",
    });
  }

  const probeDirect = async (row: ModelRow): Promise<ResolveResult> => {
    const verdict = await probeChatModel(inputs.apiKey, row.id, inputs.timeoutMs ?? 20_000, profile);
    return {
      apiId: verdict === "alive" || verdict === "alive-paid" || verdict === "alive-quota" ? row.id : undefined,
      verdict,
      probed: true,
    };
  };

  // ---------- 5) sondagens (concorrência 4)
  let probes = 0;
  if (!inputs.noProbe) {
    const queue: Array<() => Promise<void>> = [];

    const applyConfiguredVerdict = (row: ModelRow, r: ResolveResult): void => {
      if (r.verdict === "alive") {
        row.status =
          row.deprecationDays != null || (profile.freeFilter && row.meta?.status === "deprecated")
            ? "deprecating"
            : "alive";
        if (profile.freeFilter && row.meta?.status === "deprecated") row.deprecationSource = "modelsdev";
        if (row.note?.includes("sondagem") || row.note?.includes("listagem")) row.note = undefined;
        if (!accountSet.has(normKey(row.id)) && row.status === "alive" && !profile.probeAccountConfigured) {
          row.status = "deprecating";
          row.note = "fora do /v1/models mas AINDA RESPONDE (sunset) — remova só quando parar";
        }
      } else if (r.verdict === "alive-quota") {
        row.status = row.deprecationDays != null ? "deprecating" : "alive";
        row.note = "429 — vivo, mas em cota/rate-limit (free tier)";
      } else if (r.verdict === "alive-paid") {
        row.status = "paid";
        row.note = "rota existe, mas respondeu bloqueio de saldo — NÃO é modelo morto";
      } else if (r.verdict === "gone") {
        row.status = "dead";
        row.note = profile.hasSite
          ? "sondagem confirmou o fim (HTTP 410 Gone / 404)"
          : "sondagem confirmou o fim (model_retired / sem canal / 404)";
      } else {
        row.status = "deprecating";
        row.note = "sondagem inconclusiva (fila/thinking/rede) — NÃO removido automaticamente";
      }
    };

    const probeRow = async (row: ModelRow): Promise<ResolveResult> => {
      probes++;
      if (profile.probeDirect) return probeDirect(row);
      const s = slugOf(row.id);
      return resolveSlugId(s.publisher, s.slug, inputs.apiKey, {
        knownId: accountSet.has(normKey(row.id)) ? row.id : row.meta?.id,
        refresh: inputs.refresh,
        timeoutMs: inputs.timeoutMs,
        profile,
      });
    };

    // 5a. TODOS os configurados em dúvida + fantasma: sondar
    for (const row of rows.values()) {
      if (row.configured && (row.status === "inconclusive" || row.status === "unverified")) {
        queue.push(async () => {
          const r = await probeRow(row);
          applyConfiguredVerdict(row, r);
        });
      }
    }

    // 5b. novos candidatos — sondar + filtrar chat
    const isCandidate = (row: ModelRow): boolean => {
      if (row.configured) return false;
      if (row.freeEndpoint) return true; // site-free (NVIDIA) · gratuito (freemium) · opt-in pago
      // google/groq (sem filtro de gratuidade): só o que a CONTA lista é candidato
      return !profile.freeFilter && profile.probeDirect && accountSet.has(normKey(row.id));
    };
    for (const row of rows.values()) {
      if (isCandidate(row) && row.status === "unverified") {
        queue.push(async () => {
          // contas confiáveis p/ candidatos: sem sondagem (economiza cota)
          if (accountSet.has(normKey(row.id)) && !profile.probeAccountCandidates) {
            markChatWorthiness(row);
            if (row.status === "unverified") row.status = "new-ready";
            return;
          }
          const r = await probeRow(row);
          if (r.verdict === "alive") {
            if (r.apiId && normKey(r.apiId) !== normKey(row.id)) row.apiId = r.apiId;
            markChatWorthiness(row);
            if (row.status === "unverified") row.status = "new-ready";
          } else if (r.verdict === "alive-quota") {
            markChatWorthiness(row);
            if (row.status === "unverified") {
              row.status = "new-ready";
              row.note = "429 — vivo, mas em cota/rate-limit (free tier)";
            }
          } else if (r.verdict === "alive-paid") {
            if (row.paidModel) {
              // opt-in pago sem saldo: não utilizável de fato
              row.status = "notfree";
              row.freeEndpoint = false;
              row.paidModel = false;
              row.note = "rota existe, mas exige saldo (403) — topie o saldo ou remova o opt-in";
            } else {
              row.status = "notfree";
              row.freeEndpoint = false;
              row.note = "rota existe, mas exige saldo (403) — não entra na whitelist gratuita";
            }
          } else if (r.verdict === "gone") {
            row.status = "dead";
            row.note = profile.hasSite
              ? "badge Free Endpoint, mas o endpoint responde 404/410 — não utilizável (ainda)"
              : row.paidModel
                ? "ID pago listado, mas aposentado/sem canal — não utilizável"
                : "ID gratuito listado, mas aposentado/sem canal — não utilizável";
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
    paid: 4,
    inconclusive: 5,
    unverified: 6,
    notfree: 7,
    nonchat: 8,
  } as const;
  const wantSection1 = (row: ModelRow): boolean => {
    if (row.configured) return true; // conjunto ativo do usuário
    if (row.freeEndpoint || row.paidModel) return true;
    // google/groq: o que a conta lista é a oferta real — seção 1
    if (profile.probeDirect && !profile.freeFilter && row.origin === "account") return true;
    return false;
  };
  for (const row of rows.values()) {
    if (row.status === "nonchat") {
      report.rest.push(row);
    } else if (wantSection1(row)) {
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
export function effortValues(m?: ModelsDevModel, profile: ProviderProfile = NVIDIA_PROFILE): string[] {
  const opts = m?.reasoning_options?.find((o) => o.type === "effort")?.values;
  if (opts?.length) return opts;
  if (m?.reasoning) return [...profile.defaultEffortValues];
  return [];
}
