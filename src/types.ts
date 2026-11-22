// Tipos compartilhados do nimsync

/** Entrada de modelo no catálogo models.dev (https://models.dev/api.json) */
export interface ModelsDevModel {
  id: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{ type: string; values: string[] }>;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
  status?: string; // "active" | "beta" | "alpha" | "deprecated" | ...
  release_date?: string;
  last_updated?: string;
  description?: string;
  canonical_model_id?: string;
  [k: string]: unknown;
}

/** Modelo extraído do HTML do build.nvidia.com (cards da listagem) */
export interface SiteModel {
  publisher: string;
  slug: string; // slug da URL, ex "glm-5-3-flash"
  url: string;  // https://build.nvidia.com/<publisher>/<slug>
  name?: string;
  description?: string;          // descrição do card (ajuda a identificar chat)
  freeEndpoint?: boolean;        // badge "Free Endpoint" — elegível ao trial (nominalmente)
  downloadable?: boolean;        // badge "Downloadable" (container NIM)
  deprecationDays?: number;      // badge "Deprecation in Nd"
}

/** De onde vem a informação principal da linha do relatório */
export type Origin = "site+md" | "site" | "md" | "account" | "site-only";

/** Status de vida, definido por SONDAGEM quando importa */
export type RowStatus =
  | "new-ready"      // novo, sondado vivo (pronto pra configurar)
  | "alive"          // configurado e vivo
  | "deprecating"    // aviso ativo (dias) ou sunset
  | "dead"           // fim confirmado por sondagem (o código depende do provider)
  | "paid"           // rota viva, mas bloqueada por saldo — nunca é morta
  | "inconclusive"   // sondagem não decidiu (fila/rede) — nunca age
  | "notfree"        // sem Free Endpoint ou fora da whitelist gratuita
  | "unverified"     // não sondado (ex.: só no models.dev)
  | "nonchat";       // sem tool_call/reasoning (embeddings, rerank, visão…)

export interface ModelRow {
  id: string;                 // melhor ID conhecido (API confirmado ou slug)
  apiId?: string;             // ID confirmado por sondagem, se difere do id
  name?: string;
  origin: Origin;
  configured: boolean;
  status: RowStatus;
  freeEndpoint?: boolean;
  /** rota paga incluída por decisão explícita (--include-paid / toggle p) */
  paidModel?: boolean;
  deprecationDays?: number;
  deprecationSource?: "site" | "modelsdev";
  description?: string;
  meta?: ModelsDevModel;
  url?: string;
  note?: string;
}

/** Relatório em 4 seções, na ordem de confiança da origem (pedido do usuário). */
export interface Report {
  freeEndpoint: ModelRow[];   // 1) site · Free Endpoint (sondados)
  noFreeEndpoint: ModelRow[]; // 2) site · sem Free Endpoint (containers)
  modelsdevOnly: ModelRow[];  // 3) catalogados sem card no site
  rest: ModelRow[];           // 4) na conta, sem metadados de chat
  stats: { probes: number; accountCount: number; metaCount: number; siteCount: number };
}

/** Ações extraíveis do relatório */
export function addableRows(report: Report): ModelRow[] {
  return report.freeEndpoint.filter((r) => r.status === "new-ready");
}
export function removableRows(report: Report): ModelRow[] {
  return report.freeEndpoint.filter((r) => r.status === "dead" && r.configured);
}
export function deprecatingConfigured(report: Report): ModelRow[] {
  return report.freeEndpoint.filter((r) => r.status === "deprecating" && r.configured);
}

export interface PlannedChange {
  action: "add" | "remove";
  id: string;
  modelDef?: unknown;
  credEnv?: string;
  reason: string;
}

export interface CliOptions {
  config?: string;
  provider?: string;
  profile?: import("./core/profile").ProfileName;
  refresh?: boolean;
  yes?: boolean;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  timeoutMs?: number;
  restart?: boolean;
  noProbe?: boolean;
  /** incluir modelos/rotas PAGAS como candidatos (nunca é o default) */
  includePaid?: boolean;
  /** init --profile custom: endpoint do provider */
  baseUrl?: string;
  /** init --profile custom: env var da chave */
  keyEnv?: string;
  /** init --profile custom: marcador de exibição (default: derivado do provider id) */
  marker?: string;
}
