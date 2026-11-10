// nimsync TUI — revisar e aplicar o diff com checkboxes.
// Teclas: ↑/↓ move · espaço marca/desmarca · a todos os novos · r todos os mortos
//         c credencial (provider/dedicada) · enter aplica · q sai sem mudanças

import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { applyConfigEdits, readConfig, defaultConfigPath, type AddSpec } from "../core/config";
import { envNameForModel } from "../core/normalize";
import { effortValues } from "../core/diff";
import { loadContext } from "../core/context";
import type { CliOptions, DiffEntry } from "../types";
import type { SyncContext as Ctx } from "../core/context";

const MAX_LIST = 25;

interface Props {
  ctx: Ctx;
  opts: CliOptions;
  onDone: (code: number) => void;
}

function TuiApp({ ctx, opts, onDone }: Props) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [selectedNew, setSelectedNew] = useState<Set<string>>(
    () => new Set(ctx.diff.newModels.map((e) => e.id))
  );
  const [removeDead, setRemoveDead] = useState(ctx.diff.deadModels.length > 0);
  const [dedicated, setDedicated] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const news = ctx.diff.newModels;

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
        // aplicar
        try {
          const cfg = readConfig(opts.config ?? defaultConfigPath(), opts.provider);
          const adds: AddSpec[] = news
            .filter((e) => selectedNew.has(e.id))
            .map((e) => toSpec(e, dedicated));
          const removes = removeDead ? ctx.diff.deadModels.map((d) => d.id) : [];
          if (adds.length === 0 && removes.length === 0) {
            setError("nada selecionado");
            return;
          }
          const res = applyConfigEdits(cfg.path, cfg, adds, removes);
          setResult(
            `config atualizada (+${res.added.length} / -${res.removed.length})\nbackup: ${res.backup}\n` +
              `rode: opencode service restart`
          );
        } catch (err) {
          setError(String(err instanceof Error ? err.message : err));
        }
      }
    }
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        nimsync — NVIDIA NIM × {ctx.configPath}
      </Text>
      <Text dimColor>
        conta: {ctx.accountCount} · models.dev: {ctx.metaCount} · site: {ctx.siteCount} cards
      </Text>

      <Text bold color="green">
        {"\n"}NOVOS ({selectedNew.size}/{news.length} marcados):
      </Text>
      {news.length === 0 && <Text dimColor> nenhum</Text>}
      {news.slice(0, MAX_LIST).map((e, i) => (
        <Text key={e.id} color={i === cursor ? "cyan" : undefined}>
          {i === cursor ? "❯" : " "} [{selectedNew.has(e.id) ? "x" : " "}] {e.id}
          <Text dimColor> [{effortValues(e.meta).join("/") || "sem effort"}]</Text>
        </Text>
      ))}
      {news.length > MAX_LIST && (
        <Text dimColor> +{news.length - MAX_LIST} restantes — use CLI: nimsync update --all</Text>
      )}

      <Text bold color="red">
        {"\n"}MORTOS ({ctx.diff.deadModels.length}):
      </Text>
      {ctx.diff.deadModels.length === 0 && <Text dimColor> nenhum</Text>}
      {ctx.diff.deadModels.map((d) => (
        <Text key={d.id}>
          {" "}  [{removeDead ? "x" : " "}] {d.id} <Text dimColor>— {d.note}</Text>
        </Text>
      ))}

      <Text bold color="yellow">
        {"\n"}DEPRECANDO:
      </Text>
      {ctx.diff.deprecating.length === 0 && <Text dimColor> nenhum</Text>}
      {ctx.diff.deprecating.map((d) => (
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

      {error && (
        <Text color="red">{"\n"}erro: {error}</Text>
      )}
      {result && (
        <Box flexDirection="column">
          <Text color="green">{"\n"}✓ {result}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ move · espaço marca · a todos novos · r todos mortos · c credencial · enter aplica · q sai
        </Text>
      </Box>
    </Box>
  );
}

function toSpec(e: DiffEntry, dedicated: boolean): AddSpec {
  return {
    id: e.id,
    name: e.name,
    context: e.meta?.limit?.context,
    output: e.meta?.limit?.output,
    variants: effortValues(e.meta),
    credEnv: dedicated ? envNameForModel(e.id) : undefined,
  };
}

export async function runTui(opts: CliOptions): Promise<number> {
  const ctx = await loadContext(opts);
  return await new Promise<number>((resolve) => {
    const instance = render(<TuiApp ctx={ctx} opts={opts} onDone={resolve} />);
    void instance.waitUntilExit();
  });
}
