// Proveniência: quais modelos o nimsync adicionou/gerencia.
//
// Estado em ~/.local/state/nimsync/managed.json (XDG_STATE_HOME) — e não no
// opencode.jsonc (schema do OpenCode não documenta campos extras) nem no
// ~/.cache (que já se perdeu em queda de energia nesta máquina).
//
// Cada entrada guarda o nome BASE do modelo (sem marcador); a exibição no
// OpenCode é base + " ·NIM". É isso que permite distinguir "nome sem marcador
// porque ainda não passou" de "usuário renomeou na mão — respeito e não
// reescrevo".

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { version as VERSION } from "../../package.json";

/** Marcador de exibição anexado ao name dos modelos gerenciados pelo nimsync. */
export const NAME_MARKER = " ·NIM";

export interface ManagedEntry {
  /** Nome BASE de exibição (sem o marcador) — a exibição é base + NAME_MARKER. */
  name: string;
  /** ISO date da adição/migração. */
  addedAt: string;
  /** Versão do nimsync que escreveu. */
  version: string;
  /** Como virou gerenciado. */
  via: "add" | "migration";
}

type ManagedMap = Record<string, ManagedEntry>;

function statePath(): string {
  const stateHome = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return `${stateHome}/nimsync/managed.json`;
}

function load(): ManagedMap {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as ManagedMap;
  } catch {
    return {};
  }
}

function save(map: ManagedMap): void {
  try {
    mkdirSync(`${stateHome()}/nimsync`, { recursive: true }); // cria o SUBDIRETÓRIO, não só o state home
    writeFileSync(statePath(), JSON.stringify(map, null, 1));
  } catch {
    // best-effort: proveniência nunca deve quebrar o comando principal
  }
}

function stateHome(): string {
  return process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
}

export function isManaged(id: string): boolean {
  return Boolean(load()[id]);
}

export function managedEntry(id: string): ManagedEntry | undefined {
  return load()[id];
}

export function allManaged(): Array<[string, ManagedEntry]> {
  return Object.entries(load()).sort(([a], [b]) => a.localeCompare(b));
}

/** Registra/atualiza a entrada de um modelo gerenciado. */
export function recordManaged(id: string, name: string, via: ManagedEntry["via"] = "add"): void {
  const m = load();
  const prev = m[id];
  m[id] = {
    name,
    addedAt: prev?.addedAt ?? new Date().toISOString(),
    version: VERSION,
    via: prev?.via ?? via,
  };
  save(m);
}

export function unrecordManaged(id: string): void {
  const m = load();
  if (id in m) {
    delete m[id];
    save(m);
  }
}

/**
 * Semeia entradas para modelos ainda não registrados (migração dos já
 * configurados). NÃO sobrescreve entradas existentes.
 */
export function seedManaged(names: Record<string, string>): number {
  const m = load();
  let n = 0;
  for (const [id, name] of Object.entries(names)) {
    if (m[id]) continue;
    m[id] = { name, addedAt: new Date().toISOString(), version: VERSION, via: "migration" };
    n++;
  }
  if (n > 0) save(m);
  return n;
}

export function hasMarker(name: string): boolean {
  return name.endsWith(NAME_MARKER);
}

/** Anexa o marcador ao nome (idempotente). */
export function addMarker(name: string): string {
  return hasMarker(name) ? name : `${name}${NAME_MARKER}`;
}
