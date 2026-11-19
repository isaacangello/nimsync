// Proveniência: quais modelos o nimsync adicionou/gerencia.
//
// Estado em ~/.local/state/nimsync/managed.json (XDG_STATE_HOME) — e não no
// opencode.jsonc nem no cache. Entradas NVIDIA legadas continuam sem prefixo;
// AIHubMix usa "aihubmix:<model-id>", evitando colisões entre providers.
//
// Cada entrada guarda o nome BASE (sem marcador). Se o usuário renomear na mão,
// a sincronização de nomes respeita e não reescreve.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { version as VERSION } from "../../package.json";
import { NVIDIA_PROFILE, type ProviderProfile } from "./profile";

/** Marcador NVIDIA legado; novos códigos devem usar cfg.profile.marker. */
export const NAME_MARKER = NVIDIA_PROFILE.marker;

export interface ManagedEntry {
  /** Nome BASE de exibição (sem o marcador). */
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
    const stateHome = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
    mkdirSync(`${stateHome}/nimsync`, { recursive: true });
    writeFileSync(statePath(), JSON.stringify(map, null, 1));
  } catch {
    // best-effort: proveniência nunca deve quebrar o comando principal
  }
}

function managedKey(id: string, profile: ProviderProfile): string {
  return profile.name === "nvidia" ? id : `${profile.name}:${id}`;
}

export function isManaged(id: string, profile: ProviderProfile = NVIDIA_PROFILE): boolean {
  return Boolean(load()[managedKey(id, profile)]);
}

export function managedEntry(id: string, profile: ProviderProfile = NVIDIA_PROFILE): ManagedEntry | undefined {
  return load()[managedKey(id, profile)];
}

/** Entradas do perfil, sempre com o model-id sem o namespace no resultado. */
export function allManaged(profile: ProviderProfile = NVIDIA_PROFILE): Array<[string, ManagedEntry]> {
  const prefix = `${profile.name}:`;
  return Object.entries(load())
    .filter(([id]) => (profile.name === "nvidia" ? !/^[a-z0-9]+:/i.test(id) : id.startsWith(prefix)))
    .map(([id, entry]): [string, ManagedEntry] => [profile.name === "nvidia" ? id : id.slice(prefix.length), entry])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Registra/atualiza a entrada de um modelo gerenciado. */
export function recordManaged(
  id: string,
  name: string,
  via: ManagedEntry["via"] = "add",
  profile: ProviderProfile = NVIDIA_PROFILE
): void {
  const m = load();
  const key = managedKey(id, profile);
  const prev = m[key];
  m[key] = {
    name,
    addedAt: prev?.addedAt ?? new Date().toISOString(),
    version: VERSION,
    via: prev?.via ?? via,
  };
  save(m);
}

export function unrecordManaged(id: string, profile: ProviderProfile = NVIDIA_PROFILE): void {
  const m = load();
  const key = managedKey(id, profile);
  if (key in m) {
    delete m[key];
    save(m);
  }
}

/** Semeia entradas sem sobrescrever registros existentes. */
export function seedManaged(names: Record<string, string>, profile: ProviderProfile = NVIDIA_PROFILE): number {
  const m = load();
  let n = 0;
  for (const [id, name] of Object.entries(names)) {
    const key = managedKey(id, profile);
    if (m[key]) continue;
    m[key] = { name, addedAt: new Date().toISOString(), version: VERSION, via: "migration" };
    n++;
  }
  if (n > 0) save(m);
  return n;
}

export function hasMarker(name: string, profile: ProviderProfile = NVIDIA_PROFILE): boolean {
  return name.endsWith(profile.marker);
}

/** Anexa o marcador do perfil ao nome (idempotente). */
export function addMarker(name: string, profile: ProviderProfile = NVIDIA_PROFILE): string {
  return hasMarker(name, profile) ? name : `${name}${profile.marker}`;
}
