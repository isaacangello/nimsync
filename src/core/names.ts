// Sincroniza os nomes de exibição dos modelos gerenciados: garante o marcador
// " ·NIM" sem pisar em renomeações manuais.
//
// Regras por modelo gerenciado (presente no managed.json E configurado):
//   - nome já tem marcador            → nada a fazer
//   - nome === último escrito (semente da migração, sem marcador) → marca
//   - nome diferente do último escrito → usuário renomeou na mão → RESPEITA
//
// A escrita é única (um backup, uma validação, rollback automático).

import { applyNameRenames, configuredNames, type OpencodeConfig } from "./config";
import { addMarker, allManaged, hasMarker, seedManaged } from "./managed";

export interface NameSyncResult {
  renamed: Array<{ id: string; name: string }>;
  manual: string[]; // renomeados à mão — nimsync não tocou
  backup?: string;
}

/**
 * Semeia a proveniência dos modelos já configurados que ainda não estão no
 * managed.json (migração v0.3.0). Retorna quantos entrou.
 */
export function seedFromConfigured(cfg: OpencodeConfig): number {
  const names = configuredNames(cfg);
  const seed: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) {
    if (hasMarker(name)) continue; // já marcado e provavelmente registrado
    seed[id] = name;
  }
  return seedManaged(seed); // seedManaged não sobrescreve entradas existentes
}

export function syncNameMarkers(cfg: OpencodeConfig): NameSyncResult | null {
  const names = configuredNames(cfg);
  const renames: Array<{ id: string; name: string }> = [];
  const manual: string[] = [];

  for (const [id, entry] of allManaged()) {
    const cur = names[id];
    if (cur == null) continue; // registrado mas não configurado (nada a marcar)
    if (hasMarker(cur)) continue; // já marcado
    // entry.name = nome base na hora do registro; se o atual difere do base,
    // o usuário renomeou na mão (ou removeu o marcador) — respeito
    if (entry.name && cur !== entry.name) {
      manual.push(id);
      continue;
    }
    renames.push({ id, name: addMarker(cur) });
  }
  if (renames.length === 0) return { renamed: [], manual, backup: undefined };

  const res = applyNameRenames(cfg.path, cfg, renames);
  // entry.name continua sendo o nome BASE — não muda no renome
  return { renamed: renames, manual, backup: res?.backup };
}
