// nimsync init — cria um provider OpenAI-compatible sem tocar nos demais.
// Usa a mesma edição JSONC cirúrgica, backup e validação com rollback do update.

import { defaultConfigPath, initProvider, previewProviderInit } from "../core/config";
import { inferProfile } from "../core/profile";
import { C } from "../core/context";
import type { CliOptions } from "../types";

export async function runInit(opts: CliOptions): Promise<number> {
  const path = opts.config ?? defaultConfigPath();
  const profile = inferProfile(opts.provider, opts.profile);
  const providerId = opts.provider ?? profile.providerId;
  const preview = previewProviderInit(path, profile, providerId);

  if (preview === null) {
    if (opts.json) console.log(JSON.stringify({ provider: providerId, created: false }, null, 2));
    else console.log(`provider "${providerId}" já existe em ${path} — nada a fazer`);
    return 0;
  }
  if (opts.dryRun) {
    if (opts.json) console.log(JSON.stringify({ provider: providerId, created: false, dryRun: true, preview }, null, 2));
    else {
      console.log(`${C.dim}--- prévia do init (dry-run, nada foi escrito) ---${C.reset}`);
      console.log(preview);
    }
    return 0;
  }

  const result = initProvider(path, profile, providerId);
  if (opts.json) {
    console.log(JSON.stringify({ provider: providerId, created: Boolean(result), backup: result?.backup ?? "" }, null, 2));
  } else if (result) {
    console.log(`${C.green}✓ provider ${profile.label} criado${C.reset} (${providerId}) — backup: ${C.dim}${result.backup}${C.reset}`);
    console.log(`  ${C.dim}próximo passo: nimsync check --provider ${providerId} --refresh${C.reset}`);
  }
  return 0;
}
