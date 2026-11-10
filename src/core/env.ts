// Resolução de credenciais: process.env primeiro; fallback: parse do ~/.zshrc
// (o usuário mantém as chaves NVIDIA em exports do zshrc; shells não-interativos
//  não herdam, então lemos direto de lá quando necessário).

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

let zshrcCache: Map<string, string> | null = null;

function parseZshrc(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const path = `${homedir()}/.zshrc`;
    statSync(path); // garante que existe antes de ler
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      // remover aspas envolventes e comentários fora de aspas
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        const hash = value.indexOf(" #");
        if (hash >= 0) value = value.slice(0, hash).trim();
      }
      if (value) map.set(m[1], value);
    }
  } catch {
    // sem ~/.zshrc ou ilegível: segue o baile só com process.env
  }
  return map;
}

function zshrc(): Map<string, string> {
  if (!zshrcCache) zshrcCache = parseZshrc();
  return zshrcCache;
}

/** Busca VAR em process.env e, se ausente, no ~/.zshrc. */
export function resolveEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.trim()) return fromProcess.trim();
  const fromZshrc = zshrc().get(name);
  if (fromZshrc && fromZshrc.trim()) return fromZshrc.trim();
  return undefined;
}

/** Resolve strings de config do tipo "{env:NOME}" para o valor real. */
export function resolvePlaceholder(value: string): string | undefined {
  const m = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!m) return value; // não é placeholder: devolve como está
  return resolveEnv(m[1]);
}
