// nimsync update — aplica adições/remoções na config (com backup + validação).
//
// Modos:
//   update --yes              → remove mortos; só adiciona com --all
//   update --yes --all        → remove mortos + adiciona todos os novos LLMs de chat
//   update (TTY)              → prompts interativos (remover? adicionar todos/escolher)
//   update --dry-run          → mostra o plano, não escreve
//   update --json             → plano em JSON (para automação), não escreve sem --yes

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configuredModels, applyConfigEdits, previewEdits, type AddSpec } from "../core/config";
import { envNameForModel } from "../core/normalize";
import { loadContext, C } from "../core/context";
import { effortValues } from "../core/diff";
import type { CliOptions } from "../types";

export async function runUpdate(opts: CliOptions): Promise<number> {
  const ctx = await loadContext(opts);
  const { diff } = ctx;
  const interactive = Boolean(stdin.isTTY) && !opts.yes && !opts.json;

  const plannedRemoves = diff.deadModels.map((d) => d.id);
  let plannedAdds: AddSpec[] = diff.newModels.map((e) => toAddSpec(e.id, e, opts));

  // ---- decisão: remover mortos
  if (plannedRemoves.length > 0) {
    if (opts.dryRun || opts.json) {
      // apenas planeja
    } else if (!interactive && !opts.yes) {
      console.error("há modelos a remover; use --yes para aceitar os defaults ou rode interativamente em um TTY");
      return 2;
    } else if (interactive) {
      console.log(`${C.red}Modelos mortos (fora do /v1/models):${C.reset}`);
      for (const d of diff.deadModels) console.log(`  - ${d.id} ${C.dim}— ${d.note ?? ""}${C.reset}`);
      const ans = await ask(`Remover ${plannedRemoves.length} modelo(s)? [S/n] `);
      if (/^n/i.test(ans)) plannedRemoves.length = 0;
    }
  }

  // ---- decisão: adicionar novos
  if (plannedAdds.length > 0) {
    if (opts.all) {
      // mantém todos
    } else if (opts.yes) {
      plannedAdds = []; // --yes sem --all: conservador
    } else if (interactive) {
      console.log(`${C.green}Novos modelos disponíveis:${C.reset}`);
      plannedAdds.forEach((s, i) =>
        console.log(`  ${i + 1}. ${s.id} ${C.dim}[${s.variants?.join("/") ?? "sem effort"}]${C.reset}`)
      );
      const ans = await ask("Adicionar: (t)odos / (e)scolher / (n)enhum? [t/e/n] ");
      if (/^n/i.test(ans)) {
        plannedAdds = [];
      } else if (/^e/i.test(ans)) {
        const pick = await ask("Números separados por vírgula (ex: 1,3,4): ");
        const idx = new Set(
          pick
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= plannedAdds.length)
        );
        plannedAdds = plannedAdds.filter((_, i) => idx.has(i + 1));
      }
      // pergunta de credencial por modelo escolhido
      for (const spec of plannedAdds) {
        const cred = await ask(
          `Chave para ${C.cyan}${spec.id}${C.reset}: (p)rovider NVIDIA_API_KEY / (d)edicada ${envNameForModel(spec.id)}? [P/d] `
        );
        if (/^d/i.test(cred)) {
          spec.credEnv = envNameForModel(spec.id);
          console.log(
            `  ${C.dim}adicione ao ~/.zshrc:  export ${spec.credEnv}="nvapi-..."${C.reset}`
          );
        }
      }
    } else if (opts.json) {
      // planeja com provider key
    }
  }

  const total = plannedAdds.length + plannedRemoves.length;
  if (total === 0) {
    console.log("nada a fazer — config já está em dia com as regras atuais");
    return 0;
  }

  // ---- plano / execução
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          adds: plannedAdds.map((a) => ({ id: a.id, credEnv: a.credEnv ?? "NVIDIA_API_KEY" })),
          removes: plannedRemoves,
        },
        null,
        2
      )
    );
    return 0;
  }

  if (opts.dryRun) {
    const preview = previewEdits(cfgForPreview(opts), plannedAdds, plannedRemoves);
    console.log(`${C.dim}--- prévia da config (dry-run, nada foi escrito) ---${C.reset}`);
    console.log(preview);
    return 0;
  }

  const cfg = loadConfigForWrite(opts);
  const result = applyConfigEdits(cfg.path, cfg, plannedAdds, plannedRemoves);
  console.log(
    `${C.green}✓ config atualizada${C.reset} (+${result.added.length} / -${result.removed.length}) — backup: ${C.dim}${result.backup}${C.reset}`
  );
  if (plannedRemoves.length > 0) {
    console.log(`  ${C.yellow}removidos:${C.reset} ${result.removed.join(", ")}`);
  }
  if (plannedAdds.length > 0) {
    console.log(`  ${C.green}adicionados:${C.reset} ${result.added.join(", ")}`);
  }
  console.log(
    `\n${C.dim}próximo passo: ${C.reset}opencode service restart${C.dim} — o daemon resolve {env:...} na inicialização${C.reset}`
  );
  return 0;
}

function toAddSpec(
  id: string,
  entry: { name?: string; meta?: import("../types").ModelsDevModel },
  _opts: CliOptions
): AddSpec {
  return {
    id,
    name: entry.name,
    context: entry.meta?.limit?.context,
    output: entry.meta?.limit?.output,
    variants: effortValues(entry.meta),
  };
}

// helpers para re-ler a config na hora de escrever (o diff pode ter demorado)
import { readConfig, defaultConfigPath } from "../core/config";
function cfgForPreview(opts: CliOptions) {
  return readConfig(opts.config ?? defaultConfigPath(), opts.provider);
}
function loadConfigForWrite(opts: CliOptions) {
  return readConfig(opts.config ?? defaultConfigPath(), opts.provider);
}

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}
