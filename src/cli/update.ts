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
import { seedFromConfigured, syncNameMarkers } from "../core/names";
import { envNameForModel } from "../core/normalize";
import { loadContext, C } from "../core/context";
import { effortValues } from "../core/diff";
import { addableRows, removableRows, deprecatingConfigured } from "../types";
import type { CliOptions, ModelRow } from "../types";


export async function runUpdate(opts: CliOptions): Promise<number> {
  if (!opts.provider && !opts.profile) {
    console.error(`update opera por provider — rode nimsync check (multi) e depois:`);
    console.error(`  nimsync update --provider <id> [--yes] [--all]${opts.includePaid ? " [--include-paid]" : ""}`);
    return 2;
  }
  const ctx = await loadContext(opts);
  const { report, profile } = ctx;
  const interactive = Boolean(stdin.isTTY) && !opts.yes && !opts.json;

  const plannedRemoves = removableRows(report).map((r) => r.id);
  let plannedAdds: AddSpec[] = addableRows(report).map((r) => toAddSpec(r, profile));
  const deprecating = deprecatingConfigured(report);

  if (plannedAdds.length === 0 && !opts.includePaid && profile.freeFilter) {
    const paidCandidates = report.noFreeEndpoint.filter((r) => r.status === "notfree").length;
    if (paidCandidates > 0) {
      console.log(
        `  ${C.dim}${paidCandidates} modelo(s) pago(s) fora da whitelist — use --include-paid como opt-in${C.reset}`
      );
    }
  }

  // ---- decisão: remover mortos
  if (plannedRemoves.length > 0) {
    if (opts.dryRun || opts.json) {
      // apenas planeja
    } else if (!interactive && !opts.yes) {
      console.error("há modelos a remover; use --yes para aceitar os defaults ou rode interativamente em um TTY");
      return 2;
    } else if (interactive) {
      console.log(`${C.red}Modelos mortos (fim confirmado pela sondagem do ${profile.label}):${C.reset}`);
      for (const r of removableRows(report)) console.log(`  - ${r.id} ${C.dim}— ${r.note ?? ""}${C.reset}`);
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
      console.log(
        `${C.green}Novos modelos disponíveis (${
          profile.hasSite ? "Free Endpoint" : profile.freeFilter ? "gratuitos" : "elegíveis"
        } + sondagem OK):${C.reset}`
      );
      plannedAdds.forEach((s, i) =>
        console.log(
          `  ${i + 1}. ${s.paid ? `${C.magenta}[$]${C.reset} ` : ""}${s.id} ${C.dim}[${s.variants?.join("/") ?? "sem effort"}]${C.reset}`
        )
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
          `Chave para ${C.cyan}${spec.id}${C.reset}: (p)rovider ${profile.envKeys.join("/")} / (d)edicada ${envNameForModel(spec.id, profile.dedicatedKeyPrefix)}? [P/d] `
        );
        if (/^d/i.test(cred)) {
          spec.credEnv = envNameForModel(spec.id, profile.dedicatedKeyPrefix);
          console.log(`  ${C.dim}adicione ao ~/.zshrc:  export ${spec.credEnv}="${profile.keyExample}"${C.reset}`);
        }
      }
    } else if (opts.json) {
      // planeja com provider key
    }
  }

  if (deprecating.length > 0 && !opts.json) {
    console.log(`\n${C.yellow}Atenção — configurados deprecando (nenhuma ação automática):${C.reset}`);
    for (const r of deprecating) {
      const quando = r.deprecationDays != null ? `Deprecation in ${r.deprecationDays}d` : r.note ?? "";
      console.log(`  ~ ${r.id} ${C.dim}— ${quando}${C.reset}`);
    }
  }

  const total = plannedAdds.length + plannedRemoves.length;
  if (total === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ adds: [], removes: [], renames: [] }, null, 2));
      return 0;
    }
    // mesmo sem adds/removes, garante o marcador do perfil (migração idempotente)
    const nameSync = syncNames(loadConfigForWrite(opts));
    if (nameSync.renamed.length === 0) {
      console.log("nada a fazer — config já está em dia com as regras atuais");
      return 0;
    }
    console.log(
      `${C.cyan}✦${C.reset} marcador "${profile.marker}" aplicado a ${nameSync.renamed.length} modelo(s) — backup: ${C.dim}${nameSync.backup}${C.reset}`
    );
    if (nameSync.manual.length > 0) {
      console.log(`  ${C.dim}renomeações manuais respeitadas: ${nameSync.manual.join(", ")}${C.reset}`);
    }
    return 0;
  }

  // ---- plano / execução
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          adds: plannedAdds.map((a) => ({ id: a.id, credEnv: a.credEnv ?? profile.initApiKeyEnv })),
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
  // marca os gerenciados que faltam (inclui os recém-adicionados) — idempotente
  const nameSync = syncNames(readConfig(cfg.path, cfg.providerId, cfg.profile.name));
  if (nameSync.renamed.length > 0) {
    console.log(
      `  ${C.cyan}✦${C.reset} marcador "${profile.marker}" aplicado a ${nameSync.renamed.length} modelo(s) — backup: ${C.dim}${nameSync.backup}${C.reset}`
    );
  }
  if (nameSync.manual.length > 0) {
    console.log(`  ${C.dim}renomeações manuais respeitadas: ${nameSync.manual.join(", ")}${C.reset}`);
  }
  console.log(
    `\n${C.dim}próximo passo: ${C.reset}opencode service restart${C.dim} — o daemon resolve {env:...} na inicialização${C.reset}`
  );
  return 0;
}

/** semeia a proveniência dos configurados e garante os marcadores (uma escrita) */
function syncNames(cfg: ReturnType<typeof readConfig>) {
  seedFromConfigured(cfg);
  return syncNameMarkers(cfg) ?? { renamed: [], manual: [] };
}

function toAddSpec(row: ModelRow, profile: import("../core/profile").ProviderProfile): AddSpec {
  return {
    id: row.apiId ?? row.id, // ID confirmado por sondagem quando difere do slug
    name: row.name,
    context: row.meta?.limit?.context,
    output: row.meta?.limit?.output,
    variants: effortValues(row.meta, profile),
    paid: row.paidModel,
  };
}

// helpers para re-ler a config na hora de escrever (o diff pode ter demorado)
import { readConfig, defaultConfigPath } from "../core/config";
function cfgForPreview(opts: CliOptions) {
  return readConfig(opts.config ?? defaultConfigPath(), opts.provider, opts.profile);
}
function loadConfigForWrite(opts: CliOptions) {
  return readConfig(opts.config ?? defaultConfigPath(), opts.provider, opts.profile);
}

/** Pergunta interativa. EOF (Ctrl+D) resolve vazio em vez de travar. */
async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await new Promise<string>((resolve) => {
      let settled = false;
      const finish = (v: string): void => {
        if (settled) return;
        settled = true;
        resolve(v.trim());
      };
      rl.once("close", () => finish(""));
      rl.question(prompt).then(
        (answer) => finish(answer),
        () => finish("")
      );
    });
  } finally {
    rl.close();
  }
}
