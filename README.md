**[Português (BR)](README.pt-BR.md)** · **[Changelog](CHANGELOG.md)** · **[Changelog em português](CHANGELOG.pt-BR.md)**

# nimsync

> Sync free-first AI provider catalogs (NVIDIA NIM, Google AI Studio, Groq, OpenRouter, AIHubMix, custom gateways) with your OpenCode model whitelist.

Discover **new models**, detect models that have **died**, and get warnings about models being **deprecated**. The philosophy is **free first**: free providers need only a free API key, freemium providers add only their free IDs by default, and paid models are **always opt-in**.

## Why?

Model catalogs change all the time: Kimi K3 was discontinued while still configured; GLM 5.3 left the NVIDIA catalog but kept serving requests (sunset); AIHubMix can list a `*-free` ID that already returns `model_retired`. The account listing alone is not enough: nimsync probes routes before recommending additions or removals.

## Installation

### From the AUR (Arch Linux)

```bash
paru -S nimsync-bin
# or: yay -S nimsync-bin
```

### From npm (requires Bun)

```bash
npm install -g nimsync-cli
nimsync --version
nimsync-stats --help
```

> The npm package is `nimsync-cli` (the `nimsync` name is taken by another package); the installed command is still `nimsync`.

### From source

```bash
bun install
ln -sf "$(pwd)/src/index.ts" ~/.local/bin/nimsync   # global command
```

## Providers

| Provider | Tier | What you get | Key | Marker |
|---|---|---|---|---|
| NVIDIA NIM | `free` | Trial endpoints listed on build.nvidia.com | `NVIDIA_API_KEY` | ` ·NIM` |
| Google AI Studio | `free` | Gemini catalog, free quota per account | `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) | ` ·GEM` |
| Groq | `free` | Fast open models, free quota per account | `GROQ_API_KEY` | ` ·GROQ` |
| OpenRouter | `freemium` | Only `:free` IDs by default | `OPENROUTER_API_KEY` | ` ·OR` |
| AIHubMix | `freemium` | Only `-free`/`:free` (or `0/0` cost) IDs by default | `AIHUBMIX_API_KEY` | ` ·MIX` |
| Custom | `paid` | Any OpenAI-compatible gateway you own | your own env var | your choice |
| Ollama | `local` | Detected only — OpenCode already lists local models | — | — |

**Paid is never the default.** Freemium providers expose their paid routes only when you ask for them (`--include-paid`, or `p` in the TUI); those rows are tagged `[$]`.

## Usage

| Command | What it does | Writes to the config? |
|---|---|---|
| `nimsync` | Interactive TUI (checkboxes, cursor, apply) | only after confirmation |
| `nimsync providers` | Provider panel: tier, key detected, config state, model counts | **never** |
| `nimsync init` | Onboarding wizard (free first) when nothing is configured yet | yes, with backup |
| `nimsync init --profile google` | Creates the Google AI Studio provider if it does not exist | yes, with backup |
| `nimsync init --profile custom --provider <id> --base-url <url> --key-env <VAR>` | Registers any OpenAI-compatible gateway | yes, with backup |
| `nimsync check` | Report for **all** configured providers (free first) | **never** |
| `nimsync check --provider groq` | Report for a single provider | **never** |
| `nimsync update --provider <id>` | Applies changes to one provider (prompts when running in a TTY) | yes, with backup |
| `nimsync update --provider <id> --yes --all` | Removes dead models + adds all eligible new chat models | yes, with backup |
| `nimsync update --provider <id> --yes` | Conservative: only removes confirmed dead models | yes, with backup |
| `nimsync update --provider <id> --dry-run` | Previews the resulting configuration | no |
| `nimsync add <id...>` | Adds model(s) **by ID** (probe first; metadata from models.dev) | yes, with backup |
| `nimsync remove <id...>` | Removes model(s) **by ID** (alive or dead) and clears their provenance | yes, with backup |
| `nimsync refresh-meta` | Updates `limit.context/output` and `variants` of configured models | yes, with backup |
| `nimsync restore --list` | Lists the `.bak-nimsync-<ts>` backups (date, size, model counts) | no |
| `nimsync restore --latest` | Restores a backup (a safety backup of the current state is created first) | yes, with backup |
| `nimsync reset` | Alias of `restore` | yes, with backup |
| `nimsync uninstall --provider <id>` | Removes a provider block + its provenance (and unregisters a custom profile) | yes, with backup |
| `nimsync list` | Shows configured model provenance and markers | no |
| `nimsync doctor` | Minimal request per configured model (key, latency, route/alias) | no |
| `nimsync-stats` | GitHub release downloads, repository stars/forks, and AUR adoption metrics | no |

Flags: `--profile <nvidia|google|groq|openrouter|aihubmix|custom>` · `--config <path>` · `--provider <id>` · `--refresh` · `--include-paid` · `--json` · `--dry-run` · `--yes` · `--all` · `--no-probe` · `--allow-lower` · `--timeout-ms <n>` · `--backup <id>` · `--latest` · `--list`. The default profile is `nvidia`; `--provider <id>` also infers the profile automatically.

> `--json` always prints the **plan** and never writes; use `--yes` to apply without the interactive prompt.

### Getting started (free first)

```bash
nimsync providers        # see tiers, keys and what is missing
nimsync init            # wizard: free providers first, with key instructions
nimsync check           # report for every configured provider (read-only)
nimsync update --provider google --yes --all
```

The wizard never writes before you have a key: it lists the free providers, shows where to create the key, and tells you exactly which `export` line to add to `~/.zshrc`.

### Per-provider setup

```bash
export GOOGLE_API_KEY="AIza..."   # https://aistudio.google.com/apikey
nimsync init --profile google
nimsync check --provider google --refresh
nimsync update --provider google --yes --all
```

Generated blocks respect each provider's native package:

- Google AI Studio → `package: "aisdk:@ai-sdk/google"` (no `baseURL` needed)
- Groq → `package: "aisdk:@ai-sdk/openai-compatible"` + `settings.baseURL: "https://api.groq.com/openai/v1"`
- OpenRouter → `package: "aisdk:@openrouter/ai-sdk-provider"` (no `baseURL` needed)
- AIHubMix → `package: "aisdk:@ai-sdk/openai-compatible"` + `settings.baseURL: "https://aihubmix.com/v1"`

Managed names receive the provider marker (` ·NIM`, ` ·GEM`, ` ·GROQ`, ` ·OR`, ` ·MIX`) so you can spot them in OpenCode's `/models`; provenance lives in `~/.local/state/nimsync/managed.json`, and manual renames are respected.

### Paid models (opt-in)

```bash
nimsync check --provider openrouter --include-paid
nimsync update --provider openrouter --yes --all --include-paid
```

Paid candidates are tagged `[$]`. Freemium providers never mix paid routes into the free whitelist unless you explicitly opt in.

### Custom providers (any OpenAI-compatible gateway)

```bash
nimsync init --profile custom \
  --provider meugateway \
  --base-url https://meugateway.example/v1 \
  --key-env MEUGATEWAY_API_KEY \
  --marker " ·GW"
```

Custom profiles are stored in `~/.local/state/nimsync/profiles.json`, are treated as `paid` (opt-in only), and show up in `nimsync providers`, `nimsync check` and `nimsync update` like any built-in provider.

### Manual CRUD (by ID)

`update` only offers what it *discovered* in the catalog and only removes models it *proved* are dead. The commands below give you direct control:

```bash
# add by ID — the probe must confirm the route (404/410 = refused, timeout = refused)
nimsync add fastino/gliner2-pii --provider nvidia-nim
nimsync add fastino/gliner2-pii --provider nvidia-nim --no-probe   # emergency: no probe, no key needed

# remove by ID — alive or dead; provenance is cleared so it can be offered again
nimsync remove moonshotai/kimi-k3.1-pro --provider nvidia-nim

# refresh metadata — limits and reasoning variants, never the name you typed
nimsync refresh-meta --provider nvidia-nim                 # diff first, then confirmation
nimsync refresh-meta --provider nvidia-nim --allow-lower   # also allow shrinking limits

# restore — go back to a previous backup (reversible: the current state is backed up first)
nimsync restore --list
nimsync restore --latest

# uninstall a whole provider (config block + provenance + custom profile)
nimsync uninstall --provider aihubmix
```

Rules baked into these commands:

- `add` probes first: `404/410` = refused, timeout/queue = refused ("run it again"), `403 insufficient balance` = added with a warning (you asked for that ID explicitly), `429` = added (alive, quota-limited).
- `remove` never touches models you did not name; models outside the provenance registry are flagged as *manual* before removal.
- `refresh-meta` only ever touches `limit.context`, `limit.output` and `variants`. Manual renames and per-model `settings` (credentials) are left alone, and limits are only **raised** unless you pass `--allow-lower`.
- `restore` validates that the backup parses and has a `providers` key; if anything is off, the current state is put back.
- `uninstall` never touches your API key in `~/.zshrc` — that stays yours.

### Adoption and download statistics

Run `nimsync-stats` for a report of GitHub release downloads (total and per asset), repository stars/forks, and AUR votes/popularity/out-of-date status. Use `nimsync-stats --watch` to refresh every 60 seconds. This command requires `gh` (GitHub CLI), `jq`, and `curl`.

From a source checkout, you can also run `bun run stats`.

## How decisions are made

### Discovery sources

1. `/v1/models` from your account (your key decides what you can see).
2. `models.dev/api.json`, per-provider catalog: limits, `reasoning_effort`, `tool_call`, cost, and status.
3. Cards from `build.nvidia.com` — **NVIDIA only** (Free Endpoint and `Deprecation in Nd`).
4. **Probe** — the arbiter. A listing is never a verdict on its own.

### Classification

- **NEW** — eligible/free, absent from the config, alive in the probe, and has chat capabilities.
- **DEAD** — probe confirmed: `404`/`410` (NVIDIA, Groq, Google, OpenRouter, custom) or `404 model_retired` / `400 no_available_channel` (AIHubMix).
- **PAID** — route exists or returns `403` for insufficient balance; excluded from the free whitelist and never removed as dead.
- **QUOTA** — `429`: the model is alive but the free tier is rate-limited; never removed.
- **DEPRECATING** — website badge, `status: deprecated` on models.dev, or sunset (absent from the listing but still responding).
- **INCONCLUSIVE** — timeout/queue/network; **never triggers automatic removal**.

### Adoption and download statistics

See `nimsync-stats` above.

## Safety guarantees

- Backup `opencode.jsonc.bak-nimsync-<timestamp>` before every write.
- Surgical JSONC edits: **your comments are preserved**.
- Change validation with **automatic rollback** from the backup if validation fails.
- `init` is idempotent and never overwrites an existing provider.
- `update` only changes the `models` map of the selected provider.
- Probe before removal: a model that still responds is not removed.
- Timeouts and rate limits never remove anything.
- `restore` is itself reversible: the current state is backed up before the old file is put back.
- `uninstall` removes the provider block, its provenance and (for custom profiles) the registration — never your API key.
- Per-provider provenance in `~/.local/state/nimsync/managed.json` (`aihubmix:<id>`; legacy NVIDIA entries remain unprefixed; custom providers use `custom:<provider-id>:<id>`); custom profiles in `~/.local/state/nimsync/profiles.json`.

## Releases and versioning

See the [changelog](CHANGELOG.md) ([versão em português](CHANGELOG.pt-BR.md)).

[SemVer 2.0.0](https://semver.org/) — MAJOR breaks the interface, MINOR adds features, PATCH fixes bugs. Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

```bash
bun run release patch   # 0.1.0 -> 0.1.1: bump, tag, build, GitHub Release
bun run release minor   # 0.1.0 -> 0.2.0
```

Every `v*.*.*` tag also triggers `.github/workflows/publish-npm.yml`. The workflow installs dependencies, validates the code and tag version, inspects the package, and publishes it to npm with provenance using the repository's `NPM_TOKEN` secret. The tag and `package.json` versions must match.

## Development

```bash
bun install
bun run typecheck
bun src/index.ts providers
bun src/index.ts check --refresh
bun src/index.ts check --provider aihubmix --refresh
```

Engineering notes:

- build.nvidia.com **changes its SSR output depending on the browser/UA** — the scraper tries Firefox, then Chrome, and finally extracts slugs from the RSC payload (`self.__next_f`).
- Dotted IDs (`glm-5.3-flash`) versus website slugs (`glm-5-3-flash`): comparison uses a normalized key (lowercase, without `[-._]`).
- Caches live in `~/.cache/nimsync/` (6-hour TTL), one file per provider catalog. Empty results are never cached.
- Probes use a minimal real request. `doctor` also reports when a provider serves an alias (the response `model` field differs from the requested ID).

## Roadmap

- [x] AUR package (`nimsync-bin`, binaries from GitHub Releases)
- [x] Multi-provider manager (free first: Google AI Studio, Groq, OpenRouter, custom gateways)
- [x] Full CRUD by ID (`add`, `remove`, `refresh-meta`, `restore`/`reset`, `uninstall`)
- [ ] GitHub Actions for automated releases on tag push
- [ ] Weekly systemd timer with pending-change notifications

## License

MIT
