// nimsync doctor — testa cada modelo configurado com uma request mínima real.
// Diagnóstico de chaves ({env:...} resolvidas), latência e rotas mortas.
// Faz N chamadas de API reais (baratinhas: max_tokens baixo).

import { readConfig, defaultConfigPath } from "../core/config";
import { resolvePlaceholder } from "../core/env";
import { C } from "../core/context";
import type { CliOptions } from "../types";

interface Row {
  id: string;
  status: "OK" | "timeout" | "erro" | "sem chave";
  ms: number;
  detail: string;
}

export async function runDoctor(opts: CliOptions): Promise<number> {
  const configPath = opts.config ?? defaultConfigPath();
  const cfg = readConfig(configPath, opts.provider);
  const providers = cfg.data.providers as Record<
    string,
    {
      settings?: Record<string, unknown>;
      models?: Record<string, { modelID?: string; settings?: Record<string, string> }>;
    }
  >;
  const provider = providers[cfg.providerId];
  const models = provider?.models ?? {};
  const ids = Object.keys(models).sort();
  const timeoutMs = opts.timeoutMs ?? 45_000;

  console.log(`${C.bold}nimsync doctor${C.reset} — ${ids.length} modelo(s) em ${cfg.providerId} (timeout ${timeoutMs / 1000}s cada)`);

  const rows: Row[] = [];
  for (const id of ids) {
    const def = models[id] ?? {};
    const providerKey = provider.settings?.apiKey;
    const apiKey = resolvePlaceholder(def.settings?.apiKey ?? String(providerKey ?? "")) ?? "";
    const baseURL =
      resolvePlaceholder(def.settings?.baseURL ?? String(provider.settings?.baseURL ?? "")) ??
      "https://integrate.api.nvidia.com/v1";
    const upstreamId = def.modelID ?? id;

    if (!apiKey) {
      rows.push({ id, status: "sem chave", ms: 0, detail: "não resolvi {env:...} nem no modelo nem no provider" });
      continue;
    }

    const start = performance.now();
    try {
      const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: upstreamId,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: 64,
          temperature: 0.6,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        rows.push({ id, status: "OK", ms, detail: `HTTP 200` });
      } else {
        const body = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
        rows.push({ id, status: "erro", ms, detail: `HTTP ${res.status} — ${body}` });
      }
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      rows.push({
        id,
        status: isTimeout ? "timeout" : "erro",
        ms,
        detail: isTimeout ? `sem resposta em ${timeoutMs / 1000}s (fila do trial ou rota morta)` : String(err).slice(0, 120),
      });
    }
  }

  // tabela
  console.log("");
  const width = Math.max(...rows.map((r) => r.id.length), 10);
  for (const r of rows) {
    const color =
      r.status === "OK" ? C.green : r.status === "timeout" ? C.yellow : r.status === "sem chave" ? C.dim : C.red;
    const ms = r.ms > 0 ? `${(r.ms / 1000).toFixed(1)}s` : "  - ";
    console.log(`  ${r.id.padEnd(width)}  ${color}${r.status.padEnd(9)}${C.reset} ${ms.padStart(7)}  ${C.dim}${r.detail}${C.reset}`);
  }

  const ok = rows.filter((r) => r.status === "OK").length;
  const bad = rows.length - ok;
  console.log(
    `\n${C.green}${ok} OK${C.reset} / ${bad > 0 ? C.red : C.green}${bad} com problema${C.reset}`
  );
  return bad > 0 ? 1 : 0;
}
