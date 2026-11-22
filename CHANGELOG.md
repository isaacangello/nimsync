**[Português (BR)](CHANGELOG.pt-BR.md)**

# Changelog

## [Unreleased]

## [0.6.0] - 2026-11-22

### Added

- `nimsync add <id...>` adds models by ID with a mandatory probe (`--no-probe` for emergencies)
- `nimsync remove <id...>` removes models by ID (alive or dead) and clears their provenance
- `nimsync refresh-meta` updates `limit.context/output` and `variants` of configured models, showing the diff first
- `nimsync restore` (alias `reset`) lists and restores `.bak-nimsync-<ts>` backups, backing up the current state first
- `nimsync uninstall --provider <id>` removes a provider block, its provenance and its custom profile registration
- `--json` always prints the plan and never writes, `--yes` applies without prompting

### Fixed

- Provenance of custom providers is isolated per provider (`custom:<provider-id>:<id>`), so uninstalling one gateway no longer clears another one
- Profile resolution now takes registered custom profiles into account
- Provenance comparison is normalized (`kimi-k3_1-pro` matches `kimi-k3.1-pro`)

## [0.5.0] - 2026-11-22

### Added

- Multi-provider manager with a free-first philosophy: Google AI Studio, Groq, OpenRouter and custom OpenAI-compatible gateways
- New `nimsync providers` panel showing tier, detected key and configuration state
- `nimsync check` without `--profile` now iterates every configured provider, free first
- `nimsync init` without flags runs a free-first onboarding wizard with step-by-step key instructions
- `--include-paid` opt-in for freemium providers and a `p` toggle in the TUI, with paid candidates tagged `[$]`
- New `alive-quota` verdict (HTTP 429 means alive but rate-limited) which never removes a model
- Custom profiles registered by `init --profile custom` and stored in `~/.local/state/nimsync/profiles.json`
- `nimsync-stats` command with GitHub release downloads, repository stars/forks, AUR adoption metrics and a 60-second `--watch` mode
- npm package `nimsync-cli` published with provenance (`npm install -g nimsync-cli`; the installed command is `nimsync`)

### Fixed

- Onboarding wizard and interactive prompts no longer hang when stdin is closed (EOF exits gracefully)
- Release script now updates both changelogs and publishes bilingual release notes

## [0.4.0] - 2026-11-19

### Added

- AIHubMix support through the custom `aisdk:@ai-sdk/openai-compatible` provider, without changing the default NVIDIA NIM flow
- New `nimsync init --profile aihubmix` command with surgical JSONC editing, backup, validation, and rollback; the operation is idempotent
- `--profile <nvidia|aihubmix>` flag and automatic profile inference from `--provider aihubmix`
- AIHubMix whitelist restricted to `-free`/`:free` IDs or models with `0/0` cost on models.dev; separate catalog cache per provider
- AIHubMix probes classify `404 model_retired` and `400 no_available_channel` as dead; `403` for insufficient balance is reported as alive-paid and never removed
- ` ·MIX` marker, dedicated `AIHUBMIX_KEY_<MODEL>` environment variables, and `aihubmix:<id>` provenance namespace; legacy NVIDIA entries remain compatible
- `doctor` reports the upstream model when it differs from the requested ID (aliases)
- Documentation available in English and Brazilian Portuguese, with cross-linked README and changelog files

## [0.3.0] - 2026-11-12

### Added

- ` ·NIM` marker in managed model display names, making them identifiable and filterable in OpenCode `/models`
- New offline `nimsync list` command to show model provenance
- Provenance stored in `~/.local/state/nimsync/managed.json`, respecting manual renames
- Versioned release assets to avoid CDN cache collisions

## [0.2.1] - 2026-11-11

### Fixed

- TUI: nothing is preselected (neither new models nor dead-model removals), and Enter now shows a summary requiring explicit `y/n` confirmation — an accidental Enter no longer modifies the config
- Removed an extra dot from the backup timestamp (`opencode.jsonc.bak-nimsync-<ts>`)
- Banner and `--version` now read the version from `package.json` in builds (they previously displayed a fixed v0.1.0)

## [0.2.0] - 2026-11-11

### Added

- Discovery as the UNION of sources (build.nvidia.com + `/v1/models` + models.dev), with **real probing** as the life/death arbiter: 404/410 = dead, 200 = alive, timeout = inconclusive (never removed)
- Website card parsing: **Free Endpoint** badge (trial eligibility), **Deprecation in Nd**, and card description
- Chat heuristic based on descriptions for uncatalogued models (filters TTS/embeddings/vision from recommendations)
- Four-section report ordered by source confidence, with `[site+md] [site] [md] [conta]` tags
- Slug-to-API-ID map resolved by probing variants, cached in `~/.cache/nimsync/slugmap.json`
- Configured "ghost" models (absent from every source) appear in the report and are probed

---

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).
