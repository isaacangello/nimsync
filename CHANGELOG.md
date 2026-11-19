**[Português (BR)](CHANGELOG.pt-BR.md)**

# Changelog

## [Unreleased]

### Added

- `nimsync-stats` command with GitHub release downloads (total and per asset), repository stars/forks, AUR votes/popularity/out-of-date status, and a 60-second `--watch` mode
- npm package metadata and a `v*.*.*` tag-triggered GitHub Actions workflow that validates and publishes the package with provenance using `NPM_TOKEN`

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
