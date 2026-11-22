// Resolução de perfil: escolhe o ProviderProfile correto para um provider.
//
// Vive num módulo separado porque profile.ts (catálogo built-in) e managed.ts
// (perfis custom persistidos) se referenciam — resolver aqui evita ciclo.

import { allCustomProfiles } from "./managed";
import { allProfiles, getProfile, NVIDIA_PROFILE, type ProfileName, type ProviderProfile } from "./profile";

/**
 * Perfil de um provider da config.
 * - `--profile <nome>` explícito manda (exceto "custom", que precisa do id)
 * - provider id de um perfil custom persistido → esse perfil
 * - id/baseURL compatível com um built-in → esse perfil
 * - sem correspondência → NVIDIA (default histórico do nimsync)
 */
export function resolveProfile(providerId?: string, explicit?: ProfileName): ProviderProfile {
  if (explicit && explicit !== "custom") return getProfile(explicit);

  if (providerId) {
    // 1) perfis custom registrados (têm prioridade: o id do usuário é único)
    const custom = allCustomProfiles().find((p) => p.providerId === providerId);
    if (custom) return custom;

    // 2) built-ins por id ou baseURL compatível
    for (const p of allProfiles()) {
      if (p.providerId === providerId || p.providerUrlPattern.test(providerId)) return p;
    }

    if (explicit === "custom") {
      throw new Error(
        `perfil custom "${providerId}" não registrado — crie com: nimsync init --profile custom --provider ${providerId} --base-url <url> --key-env <VAR>`
      );
    }
  }
  return NVIDIA_PROFILE;
}
