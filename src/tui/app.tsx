// nimsync TUI — revisar e aplicar o report com checkboxes.
// Teclas: ↑/↓ move · espaço marca/desmarca · a todos os novos · r todos os mortos
//         c credencial (provider/dedicada) · enter -> confirmação y/n · q sai
//
// SEGURANÇA (lição do incidente de 11/nov: um Enter desavisado aplicou tudo):
//   - NADA vem pré-marcado: nem novos, nem remoção de mortos
//   - Enter NÃO aplica direto: mostra o resumo e exige y/n explícito

import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { applyConfigEdits, readConfig, defaultConfigPath, type AddSpec } from "../core/config";
import { envNameForModel } from "../core/normalize";
import { effortValues } from "../core/diff";
import { loadContext } from "../core/context";
import { addableRows, removableRows, deprecatingConfigured } from "../types";
import type { CliOptions, ModelRow } from "../types";
import type { SyncContext as Ctx } from "../core/context";

const MAX_LIST = 25;

interface Props {
  ctx: Ctx;
  opts: CliOptions;
  onDone: (code: number) => void;
}

function TuiApp({ ctx, opts, onDone }: Props) {
  const { exit } = useApp();
  const news = addableRows(ctx.report);              // novos prontos (sondagem OK)
  const deads = removableRows(ctx.report);           // configurados mortos (404/410)
  const deprec = deprecatingConfigured(ctx.report);  // configurados deprecando
  const [cursor, setCursor] = useState(0);
  // SEGURANÇA: nada vem pré-marcado — o usuário marca explicitamente o que quer
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [removeDead, setRemoveDead] = useState(false);
  const [confirming, setConfirming] = useState(false); // enter -> resumo -> y/n
  const [dedicated, setDedicated] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingAdds = news.filter((r) => selectedNew.has(r.id));
  const pendingRemoves = removeDead ? deads.map((d) => d.id) : [];

  useInput(
    (
      input: string,
      key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }
    ) => {
      if (result || error) {
        exit();
        onDone(result ? 0 : 1);
        return;
      }
      if (confirming) {
        if (input === "y" || input === "Y" || key.return) {
          try {
            const cfg = readConfig(opts.config ?? defaultConfigPath(), opts.provider);
            const adds: AddSpec[] = pendingAdds.map((e) => toSpec(e, dedicated));
            if (adds.length === 0 && pendingRemoves.length === 0) {
              setConfirming(false);
              setError("nada selecionado");
              return;
            }
            const res = applyConfigEdits(cfg.path, cfg, adds, pendingRemoves);
            setResult(
              `config atualizada (+${res.added.length} / -${res.removed.length})\nbackup: ${res.backup}\n` +
                `rode: opencode service restart`
            );
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          }
          setConfirming(false);
        } else if (input === "n" || input === "N" || key.escape) {
          setConfirming(false);
        }
        return;
      }
      if (input === "q" || key.escape) {
        exit();
        onDone(0);
      } else if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor((c) => Math.min(Math.max(news.length - 1, 0), c + 1));
      } else if (input === " ") {
        if (news[cursor]) {
          const id = news[cursor].id;
          setSelectedNew((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
      } else if (input === "a") {
        setSelectedNew((prev) => (prev.size === news.length ? new Set() : new Set(news.map((e) => e.id))));
      } else if (input === "r") {
        setRemoveDead((v) => !v);
      } else if (input === "c") {
        setDedicated((v) => !v);
      } else if (key.return) {
        if (pendingAdds.length === 0 && pendingRemoves.length === 0) {
          setError("nada selecionado — marque com espaço (ou a/r) antes de aplicar");
          return;
        }
        setConfirming(true);
      }
    }
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        nimsync — NVIDIA NIM × {ctx.configPath}
      </Text>
      <Text dimColor>
        conta: {ctx.report.stats.accountCount} · models.dev: {ctx.report.stats.metaCount} · site:{" "}
        {ctx.report.stats.siteCount} cards · sondagens: {ctx.report.stats.probes}
      </Text>

      <Text bold color="green">
        {"\n"}NOVOS prontos ({selectedNew.size}/{news.length} marcados):
      </Text>
      {news.length === 0 && <Text dimColor> nenhum</Text>}
      {news.slice(0, MAX_LIST).map((r, i) => (
        <Text key={r.id} color={i === cursor ? "cyan" : undefined}>
          {i === cursor ? "❯" : " "} [{selectedNew.has(r.id) ? "x" : " "}] {r.id}
          <Text dimColor> [{effortValues(r.meta).join("/") || "sem effort"}]</Text>
        </Text>
      ))}
      {news.length > MAX_LIST && (
        <Text dimColor> +{news.length - MAX_LIST} restantes — use CLI: nimsync update --all</Text>
      )}

      <Text bold color="red">
        {"\n"}MORTOS — sondagem confirmou ({deads.length}):
      </Text>
      {deads.length === 0 && <Text dimColor> nenhum</Text>}
      {deads.map((d) => (
        <Text key={d.id} color="red">
          {" "}  [{removeDead ? "x" : " "}] {d.id} <Text dimColor>— {d.note}</Text>
        </Text>
      ))}

      <Text bold color="yellow">
        {"\n"}DEPRECANDO:
      </Text>
      {deprec.length === 0 && <Text dimColor> nenhum</Text>}
      {deprec.map((d) => (
        <Text key={d.id} color="yellow">
          {" "}  ~ {d.id}
          <Text dimColor>
            {" "}
            — {d.deprecationDays != null ? `Deprecation in ${d.deprecationDays}d (${d.deprecationSource})` : d.note}
          </Text>
        </Text>
      ))}

      <Box marginTop={1}>
        <Text>
          credencial p/ novos: {dedicated ? "dedicada (NVIDIA_KEY_<modelo>)" : "provider (NVIDIA_API_KEY)"}
        </Text>
      </Box>

      {confirming && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">
            CONFIRMAR aplicação?
          </Text>
          <Text>  adicionar: {pendingAdds.length ? pendingAdds.map((r) => r.id).join(", ") : "nenhum"}</Text>
          <Text>  remover:   {pendingRemoves.length ? pendingRemoves.join(", ") : "nenhum"}</Text>
          <Text dimColor>  (y) aplicar · (n) cancelar</Text>
        </Box>
      )}

      {error && (
        <Text color="red">{"\n"}erro: {error}</Text>
      )}
      {result && (
        <Text color="green">{"\n"}✓ {result}</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ move · espaço marca · a todos novos · r todos mortos · c credencial · enter confirma · q sai
        </Text>
      </Box>
    </Box>
  );
}

function toSpec(r: ModelRow, dedicated: boolean): AddSpec {
  return {
    id: r.apiId ?? r.id,
    name: r.name,
    context: r.meta?.limit?.context,
    output: r.meta?.limit?.output,
    variants: effortValues(r.meta),
    credEnv: dedicated ? envNameForModel(r.id) : undefined,
  };
}

export async function runTui(opts: CliOptions): Promise<number> {
  const ctx = await loadContext(opts);
  return await new Promise<number>((resolve) => {
    const instance = render(<TuiApp ctx={ctx} opts={opts} onDone={resolve} />);
    void instance.waitUntilExit();
  });
}
