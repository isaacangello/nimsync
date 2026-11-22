// Confirmação de escrita compartilhada pelos comandos de mutação.
//
// Regras (as mesmas do `update`):
//   - `--yes`      → aplica sem perguntar
//   - `--json`     → imprime SÓ o plano em JSON e NÃO escreve
//   - `--dry-run`  → imprime o plano e NÃO escreve
//   - TTY         → pergunta (s = sim, qualquer outra coisa = não)
//   - sem TTY     → não escreve: avisa para usar --yes (nunca "aperta enter"
//                    e aplica sozinho por engano)

import { stdin } from "node:process";
import { C } from "../core/context";
import type { CliOptions } from "../types";

/** true = pode escrever; false = cancelado (nada foi tocado). */
export async function confirmWrite(opts: CliOptions, prompt: string): Promise<boolean> {
  if (opts.yes) return true;
  if (!stdin.isTTY) {
    console.error(
      `${C.yellow}modo não-interativo:${C.reset} rode de novo com ${C.cyan}--yes${C.reset} para confirmar a escrita.`
    );
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const { stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      rl.once("close", () => finish(false));
      rl.question(prompt).then(
        (a) => finish(/^s/i.test(a.trim())),
        () => finish(false)
      );
    });
  } finally {
    rl.close();
  }
}

/** Imprime um objeto em JSON (modo --json) — nada de texto humano ao lado. */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
