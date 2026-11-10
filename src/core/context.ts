// Contexto compartilhado: carrega config, as 3 fontes e computa o diff.
// Reutilizado por check, update, tui e doctor.

import { readConfig, configuredModels } from "./config";
import { resolveEnv } from "./env";
import { computeDiff } from "./diff";
import { fetchAccountModels, probeChatModel } from "../sources/nim-api";
import { fetchModelsDev } from "../sources/modelsdev";
import { fetchSiteCards, siteIndex } from "../sources/buildsite";
import type { CliOptions, Diff } from "../types";

export interface SyncContext {
  configPath: string;
  providerId: string;
  diff: Diff;
  accountCount: number;
  metaCount: number;
  siteCount: number;
  sitePages: number;
  siteDegraded: boolean;
  fromCache: boolean;
}

export async function loadContext(opts: CliOptions): Promise<SyncContext> {
  const configPath = opts.config ?? defaultConfigPath();
  const cfg = readConfig(configPath, opts.provider);
  const configured = configuredModels(cfg);

  const apiKey = resolveEnv("NVIDIA_API_KEY");
  if (!apiKey) {
    throw new Error(
      "chave NVIDIA não encontrada (procurei NVIDIA_API_KEY em process.env e ~/.zshrc)"
    );
  }

  const [account, meta, site] = await Promise.all([
    fetchAccountModels(apiKey),
    fetchModelsDev(Boolean(opts.refresh)),
    fetchSiteCards(Boolean(opts.refresh)),
  ]);

  const diff = computeDiff({
    configured,
    account,
    meta,
    siteIndex: siteIndex(site.cards),
  });

  // Sondagem dos suspeitos de morte: sumiu do catálogo, mas pode estar em
  // sunset (como glm-5.3 em nov/2026) — só remove quem responde 404 na sondagem.
  // Inconclusivo (timeout/fila/rede) vai para DEPRECANDO: nunca remoção automática.
  if (diff.deadModels.length > 0) {
    await Promise.all(
      diff.deadModels.map(async (e) => {
        const verdict = await probeChatModel(apiKey, e.id);
        if (verdict === "alive") {
          e.kind = "deprecating";
          e.note = "fora do /v1/models mas AINDA RESPONDE (sunset) — remova só quando parar de responder";
          diff.deprecating.push(e);
        } else if (verdict === "inconclusive") {
          e.kind = "deprecating";
          e.note = "sumiu do /v1/models; sondagem inconclusiva (fila/thinking) — NÃO removido automaticamente";
          diff.deprecating.push(e);
        } else {
          e.note = "sumiu do /v1/models e a sondagem confirmou: sem resposta (404)";
        }
      })
    );
    diff.deadModels = diff.deadModels.filter((e) => e.kind === "dead");
  }

  return {
    configPath,
    providerId: cfg.providerId,
    diff,
    accountCount: account.length,
    metaCount: Object.keys(meta).length,
    siteCount: site.cards.length,
    sitePages: Math.ceil(site.cards.length / 24),
    siteDegraded: site.degraded,
    fromCache: !opts.refresh,
  };
}

function defaultConfigPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

/** Relatório legível do diff (com cores ANSI). */
export function formatDiff(diff: Diff, colors = C): string {
  const out: string[] = [];
  const { green, red, yellow, dim, cyan, reset, bold } = colors;

  const section = (title: string, color: string) =>
    out.push(`\n${color}${bold}${title}${reset}`);

  if (diff.newModels.length > 0) {
    section(`NOVOS — na sua conta, fora da config (${diff.newModels.length}):`, green);
    for (const e of diff.newModels) {
      const limit = e.meta?.limit;
      const ctx = limit?.context ? `${Math.round(limit.context / 1024)}K ctx` : "?";
      const eff = effortShort(e.meta);
      out.push(`  ${green}+${reset} ${e.id} ${dim}[${eff}] ${ctx}${reset}`);
      if (e.meta?.description) out.push(`${dim}      ${truncate(e.meta.description, 96)}${reset}`);
    }
  }
  if (diff.deadModels.length > 0) {
    section(`MORTOS — na config, sumiram da conta (${diff.deadModels.length}):`, red);
    for (const e of diff.deadModels) {
      out.push(`  ${red}-${reset} ${e.id} ${dim}— ${e.note ?? ""}${reset}`);
    }
  }
  if (diff.deprecating.length > 0) {
    section(`DEPRECANDO — configurados com aviso ativo (${diff.deprecating.length}):`, yellow);
    for (const e of diff.deprecating) {
      const quando =
        e.deprecationDays != null ? `Deprecation in ${e.deprecationDays}d (${e.deprecationSource})` : e.note;
      out.push(`  ${yellow}~${reset} ${e.id} ${dim}— ${quando}${reset}`);
    }
  }
  if (diff.unknown.length > 0) {
    section(`OUTROS — na conta, sem metadados de chat (${diff.unknown.length}):`, dim);
    for (const e of diff.unknown) {
      out.push(`  ${dim}·${reset} ${e.id} ${dim}— ${truncate(e.note ?? "", 90)}${reset}`);
    }
  }
  if (
    diff.newModels.length + diff.deadModels.length + diff.deprecating.length + diff.unknown.length ===
    0
  ) {
    out.push(`\n${dim}nenhuma diferença entre config, conta e catálogo${reset}`);
  }
  out.push("");
  return out.join("\n");
}

function effortShort(m?: import("../types").ModelsDevModel): string {
  if (!m?.reasoning) return "sem reasoning";
  const vals = m.reasoning_options?.find((o) => o.type === "effort")?.values;
  return vals?.length ? `effort: ${vals.join("/")}` : "reasoning";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export { C };
