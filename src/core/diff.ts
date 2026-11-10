// O coração: cruza config do opencode × conta NVIDIA (/v1/models) × models.dev ×
// cards do site, e classifica cada modelo.

import { normKey } from "./normalize";
import type { Diff, DiffEntry, ModelsDevModel, SiteModel } from "../types";

export interface DiffInputs {
  configured: string[];
  account: string[];
  meta: Record<string, ModelsDevModel>; // catálogo models.dev (provider nvidia)
  siteIndex: Map<string, SiteModel>;    // normKey(publisher/slug) -> card
}

const metaIndex = (meta: Record<string, ModelsDevModel>): Map<string, ModelsDevModel> => {
  const m = new Map<string, ModelsDevModel>();
  for (const [id, v] of Object.entries(meta)) m.set(normKey(id), v);
  return m;
};

function deprecationFromSite(entry: DiffEntry, siteIndex: Map<string, SiteModel>): void {
  const card = siteIndex.get(normKey(entry.id));
  if (card?.deprecationDays != null) {
    entry.deprecationDays = card.deprecationDays;
    entry.deprecationSource = "site";
  }
  if (card) {
    entry.url = card.url;
    entry.name = entry.name ?? card.name;
  }
}

export function computeDiff(inputs: DiffInputs): Diff {
  const meta = metaIndex(inputs.meta);
  const accountSet = new Set(inputs.account.map(normKey));
  const configuredSet = new Set(inputs.configured.map(normKey));

  const diff: Diff = { newModels: [], deadModels: [], deprecating: [], unknown: [], unchanged: [] };

  // 1) modelos configurados: vivos? deprecando?
  for (const id of inputs.configured) {
    const m = meta.get(normKey(id));
    if (!accountSet.has(normKey(id))) {
      diff.deadModels.push({
        id,
        name: m?.name,
        kind: "dead",
        meta: m,
        note: "sumiu do /v1/models da sua conta (descontinuado)",
      });
      continue;
    }
    const entry: DiffEntry = { id, name: m?.name, kind: "ok", meta: m };
    deprecationFromSite(entry, inputs.siteIndex);
    const modelsDevDeprecated = m?.status === "deprecated";
    if (entry.deprecationDays != null || modelsDevDeprecated) {
      entry.kind = "deprecating";
      if (!entry.deprecationDays) {
        entry.deprecationSource = "modelsdev";
        entry.note = "marcado como deprecated no models.dev";
      }
      diff.deprecating.push(entry);
    } else {
      if (m && !m.tool_call && !m.reasoning) {
        entry.note = "vivo na conta, mas sem tool_call/reasoning no models.dev";
      }
      diff.unchanged.push(id);
    }
  }

  // 2) modelos da conta fora da config: novos (chat) ou sem metadados
  for (const id of inputs.account) {
    if (configuredSet.has(normKey(id))) continue;
    const m = meta.get(normKey(id));
    if (!m) {
      diff.unknown.push({ id, kind: "unknown", note: "na sua conta, sem catálogo no models.dev (provavelmente não é LLM de chat)" });
      continue;
    }
    const entry: DiffEntry = { id, name: m.name, kind: "new", meta: m };
    deprecationFromSite(entry, inputs.siteIndex);
    if (entry.deprecationDays != null || m.status === "deprecated") {
      // novo MAS já nascendo deprecated: não vale a pena adicionar
      entry.kind = "unknown";
      entry.note = entry.note ?? "já está deprecando — melhor não adicionar";
      diff.unknown.push(entry);
      continue;
    }
    if (m.tool_call || m.reasoning) {
      diff.newModels.push(entry);
    } else {
      diff.unknown.push({ ...entry, kind: "unknown", note: "no models.dev, mas sem tool_call/reasoning (não é chat)" });
    }
  }

  return diff;
}

/** Valores de reasoning_effort para as variants, a partir do models.dev. */
export function effortValues(m?: ModelsDevModel): string[] {
  const opts = m?.reasoning_options?.find((o) => o.type === "effort")?.values;
  if (opts?.length) return opts;
  if (m?.reasoning) return ["low", "high", "max"]; // padrão seguro dos NIM
  return [];
}
