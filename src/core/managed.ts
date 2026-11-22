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
import { NVIDIA_PROFILE, customProfileFromDef, type CustomProfileDef, type ProviderProfile } from "./profile";
import { normKey } from "./normalize";

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

/**
 * Namespace da proveniência por perfil.
 * - null (NVIDIA legado): a chave é o próprio id do modelo
 * - built-ins: "<nome>:<id>" (ex.: "aihubmix:gpt-4o-mini")
 * - custom: "custom:<provider-id>:<id>" — cada endpoint custom tem o seu
 *   namespace, senão dois gateways diferentes colidiria no mesmo registro.
 */
function managedPrefix(profile: ProviderProfile): string | null {
  if (profile.name === "nvidia") return null;
  if (profile.name === "custom") return `custom:${profile.providerId}:`;
  return `${profile.name}:`;
}

function managedKey(id: string, profile: ProviderProfile): string {
  const prefix = managedPrefix(profile);
  return prefix ? `${prefix}${id}` : id;
}

export function isManaged(id: string, profile: ProviderProfile = NVIDIA_PROFILE): boolean {
  return Boolean(load()[managedKey(id, profile)]);
}

export function managedEntry(id: string, profile: ProviderProfile = NVIDIA_PROFILE): ManagedEntry | undefined {
  return load()[managedKey(id, profile)];
}

/** Entradas do perfil, sempre com o model-id sem o namespace no resultado. */
export function allManaged(profile: ProviderProfile = NVIDIA_PROFILE): Array<[string, ManagedEntry]> {
  const prefix = managedPrefix(profile);
  const entries = Object.entries(load());
  if (prefix === null) {
    // NVIDIA legado: chaves sem prefixo "nome:"
    return entries
      .filter(([id]) => !/^[a-z0-9]+:/i.test(id))
      .map(([id, entry]): [string, ManagedEntry] => [id, entry])
      .sort(([a], [b]) => a.localeCompare(b));
  }
  return entries
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, entry]): [string, ManagedEntry] => [id.slice(prefix.length), entry])
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * IDs gerenciados do perfil, já normalizados (k3_1-pro ≡ k3.1-pro).
 * A comparação normalizada é a mesma usada em toda a lógica de diff — evita
 * que o mesmo modelo apareça como "gerenciado" num comando e "manual" noutro.
 */
export function managedIdSet(profile: ProviderProfile = NVIDIA_PROFILE): Set<string> {
  return new Set(allManaged(profile).map(([id]) => normKey(id)));
}

/** managedIdSet + nome base da entrada, para exibir a proveniência. */
export function managedByNormKey(
  profile: ProviderProfile = NVIDIA_PROFILE
): Map<string, { id: string; entry: ManagedEntry }> {
  const out = new Map<string, { id: string; entry: ManagedEntry }>();
  for (const [id, entry] of allManaged(profile)) out.set(normKey(id), { id, entry });
  return out;
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

/**
 * Apaga TODAS as entradas de um perfil (usado pelo uninstall de provider).
 * Entradas de outros providers não são tocadas.
 */
export function clearManaged(profile: ProviderProfile = NVIDIA_PROFILE): number {
  const m = load();
  const prefix = managedPrefix(profile);
  let n = 0;
  for (const key of Object.keys(m)) {
    const belongs = prefix === null ? !/^[a-z0-9]+:/i.test(key) : key.startsWith(prefix);
    if (!belongs) continue;
    delete m[key];
    n++;
  }
  if (n > 0) save(m);
  return n;
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

// ---------- perfis custom (init --profile custom) ----------

function profilesPath(): string {
  const stateHome = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return `${stateHome}/nimsync/profiles.json`;
}

type CustomProfiles = Record<string, CustomProfileDef>;

function loadProfiles(): CustomProfiles {
  try {
    return JSON.parse(readFileSync(profilesPath(), "utf8")) as CustomProfiles;
  } catch {
    return {};
  }
}

function saveProfiles(map: CustomProfiles): void {
  try {
    const stateHome = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
    mkdirSync(`${stateHome}/nimsync`, { recursive: true });
    writeFileSync(profilesPath(), JSON.stringify(map, null, 1));
  } catch {
    // best-effort
  }
}

export function saveCustomProfile(def: CustomProfileDef): void {
  const map = loadProfiles();
  map[def.providerId] = def;
  saveProfiles(map);
}

export function removeCustomProfile(providerId: string): void {
  const map = loadProfiles();
  if (providerId in map) {
    delete map[providerId];
    saveProfiles(map);
  }
}

/** Perfis custom persistidos, como ProviderProfile prontos para uso. */
export function allCustomProfiles(): ProviderProfile[] {
  return Object.values(loadProfiles()).map(customProfileFromDef);
}
