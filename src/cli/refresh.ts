// nimsync refresh-meta — atualiza os metadados dos modelos JÁ configurados.
//
// Recalcula `limit.context`, `limit.output` e `variants` (reasoning_effort) a
// partir do models.dev e mostra o diff antes de escrever.
//
// Regras de segurança:
//   - NUNCA toca em `name` (renomeação manual é respeitada)
//   - NUNCA toca em `settings` (chave por modelo)
//   - só gerenciados por padrão; --all inclui os manuais
//   - sem metadados no catálogo → pula e reporta
//
// exit 0 = tudo em dia ou atualizado | 1 = erro de uso | 2 = erro

import { readConfig, configuredModels, applyMetaUpdates, type MetaUpdate } from "../core/config";
import { allManaged } from "../core/managed";
import { fetchModelsDev } from "../sources/modelsdev";
import { effortValues } from "../core/diff";
import { C } from "../core/context";
import { confirmWrite, printJson } from "./prompt";
import type { CliOptions, ModelsDevModel } from "../types";
import { normKey } from "../core/normalize";

interface DiffLine {
  id: string;
  changes: string[];
}

const fmtTokens = (n?: number): string => (n == null ? "—" : n >= 1024 ? `${Math.round(n / 1024)}K` : `${n}`);

export async function runRefreshMeta(opts: CliOptions): Promise<number> {
  const cfg = readConfig(opts.config ?? defaultPath(), opts.provider, opts.profile);
  const profile = cfg.profile;
  const configured = configuredModels(cfg);
  const managedIds = new Set(allManaged(profile).map(([id]) => normKey(id)));

  const meta = await fetchModelsDev(Boolean(opts.refresh), profile.catalogId);
  const metaByNorm = new Map<string, ModelsDevModel>();
  for (const [id, m] of Object.entries(meta)) metaByNorm.set(normKey(id), m);

  // estado atual: limit/variants já gravados na config
  const providers = cfg.data.providers as Record<string, {
    models?: Record<string, { limit?: { context?: number; output?: number }; variants?: Array<{ id: string }> }>;
  }>;
  const current = providers?.[cfg.providerId]?.models ?? {};

  const diffs: DiffLine[] = [];
  const updates: MetaUpdate[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const reductions: Array<{ id: string; reasons: string[] }> = [];

  for (const id of configured) {
    if (!opts.all && !managedIds.has(normKey(id))) {
      skipped.push({ id, reason: "não gerenciado (use --all para incluir)" });
      continue;
    }
    const m = metaByNorm.get(normKey(id));
    if (!m) {
      skipped.push({ id, reason: "sem metadados no models.dev" });
      continue;
    }
    const now = current[id];
    const changes: string[] = [];
    const upd: MetaUpdate = { id };

    // ---- limit.context / limit.output
    const wantContext = m.limit?.context;
    const wantOutput = m.limit?.output;
    const haveContext = now?.limit?.context;
    const haveOutput = now?.limit?.output;
    const limit: { context?: number; output?: number } = {};
    // Reduzir um limite pode quebrar o setup do usuário (o valor pode ter sido
    // ajustado à mão) — por padrão só AMPLIA; reduzir exige --allow-lower.
    const lowerSkipped: string[] = [];
    if (wantContext != null && wantContext !== haveContext) {
      if (haveContext != null && wantContext < haveContext && !opts.allowLower) {
        lowerSkipped.push(`context ${fmtTokens(haveContext)} → ${fmtTokens(wantContext)} (redução — use --allow-lower)`);
      } else {
        changes.push(`context ${fmtTokens(haveContext)} → ${fmtTokens(wantContext)}`);
        limit.context = wantContext;
      }
    }
    if (wantOutput != null && wantOutput !== haveOutput) {
      if (haveOutput != null && wantOutput < haveOutput && !opts.allowLower) {
        lowerSkipped.push(`output ${fmtTokens(haveOutput)} → ${fmtTokens(wantOutput)} (redução — use --allow-lower)`);
      } else {
        changes.push(`output ${fmtTokens(haveOutput)} → ${fmtTokens(wantOutput)}`);
        limit.output = wantOutput;
      }
    }
    if (Object.keys(limit).length > 0) upd.limit = limit;

    // ---- variants (reasoning_effort)
    const wantVariants = effortValues(m, profile);
    const haveVariants = (now?.variants ?? []).map((v) => v.id);
    if (wantVariants.length > 0) {
      const same =
        wantVariants.length === haveVariants.length && wantVariants.every((v, i) => v === haveVariants[i]);
      if (!same) {
        changes.push(
          `variants [${haveVariants.join(", ") || "—"}] → [${wantVariants.join(", ")}]`
        );
        upd.variants = wantVariants;
      }
    }

    if (changes.length > 0) {
      diffs.push({ id, changes });
      updates.push(upd);
    }
    if (lowerSkipped.length > 0) {
      reductions.push({ id, reasons: lowerSkipped });
    }
  }

  console.log(`${C.bold}nimsync refresh-meta${C.reset} — ${profile.label} ${C.dim}(${cfg.providerId})${C.reset}`);
  console.log(`  ${C.dim}${configured.length} modelo(s) configurado(s) · catálogo: ${profile.catalogId}${C.reset}`);

  // ---- modo --json: só o plano, nada é escrito
  if (opts.json) {
    printJson({
      command: "refresh-meta",
      provider: cfg.providerId,
      profile: profile.name,
      updates: diffs,
      skipped,
      reductions,
      written: false,
    });
    return 0;
  }

  if (diffs.length === 0) {
    console.log(`\n${C.green}✓ metadados em dia — nada a atualizar.${C.reset}`);
    if (skipped.length > 0) reportSkipped(skipped);
    if (reductions.length > 0) reportReductions(reductions);
    return 0;
  }

  console.log(`\n${C.bold}diff${C.reset} (${diffs.length} modelo(s)):`);
  for (const d of diffs) {
    console.log(`  ${C.cyan}${d.id}${C.reset}`);
    for (const c of d.changes) console.log(`      ${C.dim}${c}${C.reset}`);
  }
  if (skipped.length > 0) reportSkipped(skipped);
  if (reductions.length > 0) reportReductions(reductions);

  if (opts.dryRun) {
    console.log(`\n${C.dim}--- dry-run: nada foi escrito ---${C.reset}`);
    return 0;
  }

  if (!(await confirmWrite(opts, `Aplicar em ${diffs.length} modelo(s)? (s/n) `))) {
    console.log(`${C.dim}cancelado — nada foi escrito.${C.reset}`);
    return 1;
  }

  const result = applyMetaUpdates(cfg.path, cfg, updates);
  console.log(
    `${C.green}✓ metadados de ${result?.updated.length ?? 0} modelo(s) atualizados${C.reset} — backup: ${C.dim}${result?.backup}${C.reset}`
  );
  console.log(`\n${C.dim}próximo passo: opencode service restart${C.reset}`);
  return 0;
}

function reportSkipped(skipped: Array<{ id: string; reason: string }>): void {
  if (skipped.length === 0) return;
  console.log(`\n${C.dim}ignorados (${skipped.length}):${C.reset}`);
  for (const s of skipped) console.log(`  ${C.dim}· ${s.id} — ${s.reason}${C.reset}`);
}

/** Reduções de limite que ficam pendentes (exigem --allow-lower). */
function reportReductions(reductions: Array<{ id: string; reasons: string[] }>): void {
  if (reductions.length === 0) return;
  console.log(`\n${C.yellow}reduções não aplicadas (${reductions.length}):${C.reset}`);
  for (const r of reductions) {
    console.log(`  ${C.yellow}~${C.reset} ${r.id}`);
    for (const reason of r.reasons) console.log(`      ${C.dim}${reason}${C.reset}`);
  }
}

function defaultPath(): string {
  return `${process.env.HOME}/.config/opencode/opencode.jsonc`;
}
