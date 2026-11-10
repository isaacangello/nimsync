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
  deprecationDays?: number; // presente quando há badge "Deprecation in Nd"
}

export type DiffKind = "new" | "dead" | "deprecating" | "unknown" | "ok";

export interface DiffEntry {
  id: string;            // modelID canônico (ex "z-ai/glm-5.3-flash")
  name?: string;
  kind: DiffKind;
  deprecationDays?: number;
  deprecationSource?: "site" | "modelsdev";
  meta?: ModelsDevModel;
  url?: string;
  note?: string;
}

export interface Diff {
  newModels: DiffEntry[];      // na conta + models.dev, fora da config (chat)
  deadModels: DiffEntry[];     // na config, sumiram do /v1/models
  deprecating: DiffEntry[];    // na config e com aviso de deprecação
  unknown: DiffEntry[];        // na conta, sem metadados no models.dev
  unchanged: string[];         // na config e saudáveis
}

export interface PlannedChange {
  action: "add" | "remove";
  id: string;
  modelDef?: unknown; // definição a inserir no JSONC (só para "add")
  credEnv?: string;   // env var da chave, se dedicada
  reason: string;
}

export interface CliOptions {
  config?: string;
  provider?: string;
  refresh?: boolean;
  yes?: boolean;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  timeoutMs?: number;
  restart?: boolean;
}
