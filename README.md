**[Português (BR)](README.pt-BR.md)** · **[Changelog](CHANGELOG.md)** · **[Changelog em português](CHANGELOG.pt-BR.md)**

# nimsync

> Sync the NVIDIA NIM and AIHubMix catalogs with your OpenCode model whitelist.

Discover **new models**, detect models that have **died**, and get warnings about models being **deprecated**. NVIDIA remains the default behavior; AIHubMix uses the custom `aisdk:@ai-sdk/openai-compatible` provider and only adds free models by default.

## Why?

Model catalogs change all the time: Kimi K3 was discontinued while still configured; GLM 5.3 left the NVIDIA catalog but kept serving requests (sunset); AIHubMix can list a `*-free` ID that already returns `model_retired`. The account listing alone is not enough: nimsync probes routes before recommending additions or removals.

## Installation

### From the AUR (Arch Linux)

```bash
paru -S nimsync-bin
# or: yay -S nimsync-bin
```

### From source

```bash
bun install
ln -sf "$(pwd)/src/index.ts" ~/.local/bin/nimsync   # global command
```

## Usage

| Command | What it does | Writes to the config? |
|---|---|---|
| `nimsync` | Interactive TUI (checkboxes, cursor, apply) | only after confirmation |
| `nimsync init --profile aihubmix` | Creates the AIHubMix provider if it does not exist | yes, with backup |
| `nimsync check` | NVIDIA report for new/dead/deprecating models | **never** |
| `nimsync check --provider aihubmix` | AIHubMix report; only free models are candidates | **never** |
| `nimsync update` | Applies changes (prompts when running in a TTY) | yes, with backup |
| `nimsync update --yes --all` | Removes dead models + adds all eligible new chat models | yes, with backup |
| `nimsync update --yes` | Conservative: only removes confirmed dead models | yes, with backup |
| `nimsync update --dry-run` | Previews the resulting configuration | no |
| `nimsync list` | Shows configured model provenance and markers | no |
| `nimsync doctor` | Minimal request per configured model (key, latency, route/alias) | no |

Flags: `--profile <nvidia|aihubmix>` · `--config <path>` · `--provider <id>` · `--refresh` · `--json` · `--dry-run` · `--timeout-ms <n>`. The default profile is `nvidia`; `--provider aihubmix` also infers the profile automatically.

### AIHubMix: configuration and synchronization

Set `AIHUBMIX_API_KEY` or `AIHUBMIX` in your environment/`~/.zshrc`. The provider created by `init` uses `{env:AIHUBMIX}`.

```bash
nimsync init --profile aihubmix
nimsync check --provider aihubmix --refresh
nimsync update --provider aihubmix --yes --all
nimsync doctor --provider aihubmix
```

The generated block uses:

- `package: "aisdk:@ai-sdk/openai-compatible"`
- `settings.baseURL: "https://aihubmix.com/v1"` (alternative endpoint documented by the service: `https://api.inferera.com/v1`)
- `settings.apiKey: "{env:AIHUBMIX}"`
- `models: {}` initially

Only IDs ending in `-free`/`:free` or models with `0/0` cost on models.dev are added automatically. Paid models appear outside the whitelist; a `403` caused by insufficient balance means **alive route, but paid**, never a dead model. Managed names receive ` ·MIX`; NVIDIA continues to use ` ·NIM`.

## How decisions are made

### NVIDIA NIM

1. `/v1/models` from your account.
2. `models.dev/api.json`, `nvidia` catalog: limits, `reasoning_effort`, `tool_call`, cost, and status.
3. Cards from `build.nvidia.com`: Free Endpoint and `Deprecation in Nd`.

### AIHubMix

1. `/v1/models` at `https://aihubmix.com/v1`.
2. `models.dev/api.json`, `aihubmix` catalog, with an independent cache.
3. Direct ID probing, without website scraping or slug variants.

Classification:

- **NEW** — eligible/free, absent from the config, alive in the probe, and has chat capabilities.
- **DEAD** — NVIDIA: `404/410`; AIHubMix: `404 model_retired` or `400 no_available_channel`.
- **PAID** — route exists or returns `403` for insufficient balance; excluded from the free whitelist and never removed as dead.
- **DEPRECATING** — website badge, `status: deprecated` on models.dev, or sunset (absent from the listing but still responding).
- **INCONCLUSIVE** — timeout/queue/network; **never triggers automatic removal**.

## Safety guarantees

- Backup `opencode.jsonc.bak-nimsync-<timestamp>` before every write.
- Surgical JSONC edits: **your comments are preserved**.
- Change validation with **automatic rollback** from the backup if validation fails.
- `init` is idempotent and never overwrites an existing provider.
- `update` only changes the `models` map of the selected provider.
- Probe before removal: a model that still responds is not removed.
- Per-provider provenance in `~/.local/state/nimsync/managed.json` (`aihubmix:<id>`; legacy NVIDIA entries remain unprefixed).

## Releases and versioning

See the [changelog](CHANGELOG.md) ([versão em português](CHANGELOG.pt-BR.md)).

[SemVer 2.0.0](https://semver.org/) — MAJOR breaks the interface, MINOR adds features, PATCH fixes bugs. Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

```bash
bun run release patch   # 0.1.0 -> 0.1.1: bump, tag, build, GitHub Release
bun run release minor   # 0.1.0 -> 0.2.0
```

## Development

```bash
bun install
bun run typecheck
bun src/index.ts check --refresh
bun src/index.ts check --provider aihubmix --refresh
```

Engineering notes:

- build.nvidia.com **changes its SSR output depending on the browser/UA** — the scraper tries Firefox, then Chrome, and finally extracts slugs from the RSC payload (`self.__next_f`).
- Dotted IDs (`glm-5.3-flash`) versus website slugs (`glm-5-3-flash`): comparison uses a normalized key (lowercase, without `[-._]`).
- Caches live in `~/.cache/nimsync/` (6-hour TTL); `modelsdev.json` is the legacy NVIDIA cache and `modelsdev-aihubmix.json` is independent. Empty results are never cached.
- Probes use a minimal real request. `doctor` also reports when AIHubMix serves an alias (the response `model` field differs from the requested ID).

## Roadmap

- [x] AUR package (`nimsync-bin`, binaries from GitHub Releases)
- [ ] GitHub Actions for automated releases on tag push
- [ ] Weekly systemd timer with pending-change notifications
- [ ] `--refresh-meta` to update limits of already configured models
- [ ] Explicit option to include paid AIHubMix models

## License

MIT
