**[English](README.md)** · **[Changelog em português](CHANGELOG.pt-BR.md)** · **[Changelog in English](CHANGELOG.md)**

# nimsync

> Sincroniza os catálogos NVIDIA NIM e AIHubMix com a whitelist de modelos do seu OpenCode.

Descobre **modelos novos**, detecta os que **morreram** e avisa dos que estão **deprecando**. O comportamento NVIDIA permanece o padrão; o AIHubMix usa provider customizado `aisdk:@ai-sdk/openai-compatible` e adiciona somente modelos gratuitos por padrão.

## Por quê?

As listas de modelos mudam o tempo todo: o Kimi K3 foi descontinuado com o usuário configurado; o GLM 5.3 saiu do catálogo NVIDIA mas continuou servindo (sunset); o AIHubMix pode listar um ID `*-free` que já responde `model_retired`. A listagem da conta sozinha não basta: o nimsync sonda as rotas antes de recomendar adições ou remoções.

## Instalação

### Pelo AUR (Arch Linux)

```bash
paru -S nimsync-bin
# ou: yay -S nimsync-bin
```

### Pelo npm (requer Bun)

```bash
npm install -g nimsync
nimsync --version
nimsync-stats --help
```

### Pelo código-fonte

```bash
bun install
ln -sf "$(pwd)/src/index.ts" ~/.local/bin/nimsync   # comando global
```

## Uso

| Comando | O que faz | Escreve na config? |
|---|---|---|
| `nimsync` | TUI interativa (checkboxes, cursor, aplicar) | só com confirmação |
| `nimsync init --profile aihubmix` | cria o provider AIHubMix, se ainda não existir | sim, com backup |
| `nimsync check` | relatório NVIDIA de novos/mortos/deprecando | **nunca** |
| `nimsync check --provider aihubmix` | relatório AIHubMix; só gratuitos são candidatos | **nunca** |
| `nimsync update` | aplica mudanças (prompts se TTY) | sim, com backup |
| `nimsync update --yes --all` | remove mortos + adiciona todos os novos chat elegíveis | sim, com backup |
| `nimsync update --yes` | conservador: remove só mortos confirmados | sim, com backup |
| `nimsync update --dry-run` | prévia da config resultante | não |
| `nimsync list` | origem e marcador dos modelos configurados | não |
| `nimsync doctor` | request mínima por modelo configurado (chave, latência, rota/alias) | não |
| `nimsync-stats` | downloads do GitHub Releases, stars/forks e métricas de adoção no AUR | não |

Flags: `--profile <nvidia|aihubmix>` · `--config <path>` · `--provider <id>` · `--refresh` · `--json` · `--dry-run` · `--timeout-ms <n>`. O perfil default é `nvidia`; `--provider aihubmix` também infere o perfil automaticamente.

### AIHubMix: configuração e sincronização

Defina `AIHUBMIX_API_KEY` ou `AIHUBMIX` no ambiente/`~/.zshrc`. O `init` usa `{env:AIHUBMIX}` no provider criado.

```bash
nimsync init --profile aihubmix
nimsync check --provider aihubmix --refresh
nimsync update --provider aihubmix --yes --all
nimsync doctor --provider aihubmix
```

O bloco criado usa:

- `package: "aisdk:@ai-sdk/openai-compatible"`
- `settings.baseURL: "https://aihubmix.com/v1"` (endpoint alternativo documentado pelo serviço: `https://api.inferera.com/v1`)
- `settings.apiKey: "{env:AIHUBMIX}"`
- `models: {}` inicialmente

Só entram automaticamente IDs terminados em `-free`/`:free` ou modelos com custo `0/0` no models.dev. Modelos pagos aparecem fora da whitelist; `403` por saldo insuficiente significa **rota viva, mas paga**, nunca modelo morto. Os nomes gerenciados recebem ` ·MIX`; NVIDIA continua com ` ·NIM`.

### Estatísticas de adoção e downloads

Execute `nimsync-stats` para ver downloads do GitHub Releases (total e por asset), stars/forks do repositório e votos/popularidade/out-of-date no AUR. Use `nimsync-stats --watch` para atualizar a cada 60 segundos. O comando requer `gh` (GitHub CLI), `jq` e `curl`.

Em um checkout do código-fonte, você também pode usar `bun run stats`.

## Como decide

### NVIDIA NIM

1. `/v1/models` na sua conta.
2. `models.dev/api.json`, catálogo `nvidia`: limites, `reasoning_effort`, `tool_call`, custo e status.
3. Cards de `build.nvidia.com`: Free Endpoint e `Deprecation in Nd`.

### AIHubMix

1. `/v1/models` em `https://aihubmix.com/v1`.
2. `models.dev/api.json`, catálogo `aihubmix`, com cache independente.
3. Sondagem direta do ID, sem scraping de site e sem variantes de slug.

Classificação:

- **NOVO** — elegível/gratuito, fora da config, com sondagem viva e características de chat.
- **MORTO** — NVIDIA: `404/410`; AIHubMix: `404 model_retired` ou `400 no_available_channel`.
- **PAGO** — rota presente ou `403` de saldo insuficiente; não entra na whitelist gratuita e nunca é removido como morto.
- **DEPRECANDO** — badge do site, `status: deprecated` no models.dev, ou sunset (fora da listagem mas ainda responde).
- **INCONCLUSIVO** — timeout/fila/rede; **nunca causa remoção automática**.

## Garantias de segurança

- Backup `opencode.jsonc.bak-nimsync-<timestamp>` antes de qualquer escrita.
- Edição cirúrgica do JSONC: **seus comentários são preservados**.
- Validação das mudanças com **rollback automático** do backup se a validação falhar.
- `init` é idempotente e nunca sobrescreve um provider existente.
- Somente o mapa `models` do provider selecionado é alterado pelo `update`.
- Sondagem antes de remover: modelo que ainda responde não é removido.
- Proveniência separada por provider em `~/.local/state/nimsync/managed.json` (`aihubmix:<id>`; entradas NVIDIA legadas continuam sem prefixo).

## Releases e versionamento

Consulte o [changelog em português](CHANGELOG.pt-BR.md) ([English version](CHANGELOG.md)).

[SemVer 2.0.0](https://semver.org/lang/pt-BR/) — MAJOR quebra interface, MINOR adiciona feature, PATCH corrige. Commits no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/).

```bash
bun run release patch   # 0.1.0 -> 0.1.1: bump, tag, build, GitHub Release
bun run release minor   # 0.1.0 -> 0.2.0
```

Toda tag `v*.*.*` também dispara `.github/workflows/publish-npm.yml`. O workflow instala as dependências, valida o código e a versão da tag, inspeciona o pacote e publica no npm com provenance usando o secret `NPM_TOKEN` do repositório. As versões da tag e do `package.json` precisam ser iguais.

## Desenvolvimento

```bash
bun install
bun run typecheck
bun src/index.ts check --refresh
bun src/index.ts check --provider aihubmix --refresh
```

Notas de engenharia:

- O build.nvidia.com **varia o SSR conforme o browser/UA** — o scraper tenta Firefox, depois Chrome, e por último extrai slugs do payload RSC (`self.__next_f`).
- IDs pontuados (`glm-5.3-flash`) vs slugs do site (`glm-5-3-flash`): comparação por chave normalizada (lowercase, sem `[-._]`).
- Caches em `~/.cache/nimsync/` (TTL 6h); `modelsdev.json` é o cache NVIDIA legado e `modelsdev-aihubmix.json` é independente. Resultados vazios não são cacheados.
- A sondagem usa request mínima real. O `doctor` também mostra quando o AIHubMix serve um alias (o campo `model` da resposta difere do ID solicitado).

## Roadmap

- [x] Pacote AUR (`nimsync-bin`, binários do GitHub Release)
- [ ] GitHub Actions para release automatizado no tag push
- [ ] Timer systemd semanal + notificação de pendências
- [ ] `--refresh-meta` para atualizar limites de modelos já configurados
- [ ] Opção explícita para incluir modelos pagos do AIHubMix

## Licença

MIT
