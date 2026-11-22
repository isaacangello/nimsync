**[English](README.md)** · **[Changelog em português](CHANGELOG.pt-BR.md)** · **[Changelog in English](CHANGELOG.md)**

# nimsync

> Sincroniza catálogos de provedores de IA (NVIDIA NIM, Google AI Studio, Groq, OpenRouter, AIHubMix, gateways custom) com a whitelist de modelos do seu OpenCode — **grátis primeiro**.

Descobre **modelos novos**, detecta os que **morreram** e avisa dos que estão **deprecando**. A filosofia é **grátis primeiro**: provedores free exigem apenas uma chave gratuita, provedores freemium adicionam somente os IDs gratuitos por padrão, e modelos pagos são **sempre opt-in**.

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

## Provedores

| Provedor | Tier | O que você recebe | Chave | Marcador |
|---|---|---|---|---|
| NVIDIA NIM | `free` | Endpoints de trial listados no build.nvidia.com | `NVIDIA_API_KEY` | ` ·NIM` |
| Google AI Studio | `free` | Catálogo Gemini, cota grátis por conta | `GOOGLE_API_KEY` (ou `GEMINI_API_KEY`) | ` ·GEM` |
| Groq | `free` | Modelos abertos rápidos, cota grátis por conta | `GROQ_API_KEY` | ` ·GROQ` |
| OpenRouter | `freemium` | Só IDs `:free` por padrão | `OPENROUTER_API_KEY` | ` ·OR` |
| AIHubMix | `freemium` | Só IDs `-free`/`:free` (ou custo `0/0`) por padrão | `AIHUBMIX_API_KEY` | ` ·MIX` |
| Custom | `paid` | Qualquer gateway OpenAI-compatible seu | sua env var | você escolhe |
| Ollama | `local` | Apenas detecção — o OpenCode já lista os modelos locais | — | — |

**Pago nunca é o default.** Provedores freemium só expõem as rotas pagas quando você pede (`--include-paid`, ou `p` na TUI); essas linhas recebem a tag `[$]`.

## Uso

| Comando | O que faz | Escreve na config? |
|---|---|---|
| `nimsync` | TUI interativa (checkboxes, cursor, aplicar) | só com confirmação |
| `nimsync providers` | painel de provedores: tier, chave detectada, estado, contagem de modelos | **nunca** |
| `nimsync init` | wizard de onboarding (grátis primeiro) quando nada está configurado | sim, com backup |
| `nimsync init --profile google` | cria o provider Google AI Studio, se ainda não existir | sim, com backup |
| `nimsync init --profile custom --provider <id> --base-url <url> --key-env <VAR>` | registra qualquer gateway OpenAI-compatible | sim, com backup |
| `nimsync check` | relatório de **todos** os providers configurados (grátis primeiro) | **nunca** |
| `nimsync check --provider groq` | relatório de um provider específico | **nunca** |
| `nimsync update --provider <id>` | aplica mudanças em um provider (prompts se TTY) | sim, com backup |
| `nimsync update --provider <id> --yes --all` | remove mortos + adiciona todos os novos chat elegíveis | sim, com backup |
| `nimsync update --provider <id> --yes` | conservador: remove só mortos confirmados | sim, com backup |
| `nimsync update --provider <id> --dry-run` | prévia da config resultante | não |
| `nimsync list` | origem e marcador dos modelos configurados | não |
| `nimsync doctor` | request mínima por modelo configurado (chave, latência, rota/alias) | não |
| `nimsync-stats` | downloads do GitHub Releases, stars/forks e métricas de adoção no AUR | não |

Flags: `--profile <nvidia|google|groq|openrouter|aihubmix|custom>` · `--config <path>` · `--provider <id>` · `--refresh` · `--include-paid` · `--json` · `--dry-run` · `--yes` · `--all` · `--timeout-ms <n>`. O perfil default é `nvidia`; `--provider <id>` também infere o perfil automaticamente.

### Começando (grátis primeiro)

```bash
nimsync providers        # ver tiers, chaves e o que falta
nimsync init            # wizard: provedores grátis primeiro, com instruções da chave
nimsync check           # relatório de todos os providers configurados (somente leitura)
nimsync update --provider google --yes --all
```

O wizard nunca escreve antes de você ter a chave: ele lista os provedores gratuitos, mostra onde criar a chave e diz exatamente qual linha `export` adicionar no `~/.zshrc`.

### Configuração por provider

```bash
export GOOGLE_API_KEY="AIza..."   # https://aistudio.google.com/apikey
nimsync init --profile google
nimsync check --provider google --refresh
nimsync update --provider google --yes --all
```

Os blocos gerados respeitam o package nativo de cada provider:

- Google AI Studio → `package: "aisdk:@ai-sdk/google"` (sem `baseURL`)
- Groq → `package: "aisdk:@ai-sdk/openai-compatible"` + `settings.baseURL: "https://api.groq.com/openai/v1"`
- OpenRouter → `package: "aisdk:@openrouter/ai-sdk-provider"` (sem `baseURL`)
- AIHubMix → `package: "aisdk:@ai-sdk/openai-compatible"` + `settings.baseURL: "https://aihubmix.com/v1"`

Os nomes gerenciados recebem o marcador do provider (` ·NIM`, ` ·GEM`, ` ·GROQ`, ` ·OR`, ` ·MIX`) para você identificá-los no `/models` do OpenCode; a proveniência fica em `~/.local/state/nimsync/managed.json`, e renomeações manuais são respeitadas.

### Modelos pagos (opt-in)

```bash
nimsync check --provider openrouter --include-paid
nimsync update --provider openrouter --yes --all --include-paid
```

Candidatos pagos recebem a tag `[$]`. Provedores freemium nunca misturam rotas pagas na whitelist gratuita sem opt-in explícito.

### Providers custom (qualquer gateway OpenAI-compatible)

```bash
nimsync init --profile custom \
  --provider meugateway \
  --base-url https://meugateway.example/v1 \
  --key-env MEUGATEWAY_API_KEY \
  --marker " ·GW"
```

Perfis custom ficam em `~/.local/state/nimsync/profiles.json`, são tratados como `paid` (só com opt-in) e aparecem em `nimsync providers`, `nimsync check` e `nimsync update` como qualquer provider built-in.

### Estatísticas de adoção e downloads

Execute `nimsync-stats` para ver downloads do GitHub Releases (total e por asset), stars/forks do repositório e votos/popularidade/out-of-date no AUR. Use `nimsync-stats --watch` para atualizar a cada 60 segundos. O comando requer `gh` (GitHub CLI), `jq` e `curl`.

Em um checkout do código-fonte, você também pode usar `bun run stats`.

## Como decide

### Fontes de descoberta

1. `/v1/models` da sua conta (a chave define o que você enxerga).
2. `models.dev/api.json`, catálogo por provider: limites, `reasoning_effort`, `tool_call`, custo e status.
3. Cards do `build.nvidia.com` — **somente NVIDIA** (Free Endpoint e `Deprecation in Nd`).
4. **Sondagem** — o árbitro. Listagem nunca é veredito sozinha.

### Classificação

- **NOVO** — elegível/gratuito, fora da config, com sondagem viva e características de chat.
- **MORTO** — sondagem confirmou: `404`/`410` (NVIDIA, Groq, Google, OpenRouter, custom) ou `404 model_retired` / `400 no_available_channel` (AIHubMix).
- **PAGO** — rota presente ou `403` de saldo insuficiente; não entra na whitelist gratuita e nunca é removido como morto.
- **COTA** — `429`: o modelo está vivo, mas o free tier está com rate-limit; nunca é removido.
- **DEPRECANDO** — badge do site, `status: deprecated` no models.dev, ou sunset (fora da listagem mas ainda responde).
- **INCONCLUSIVO** — timeout/fila/rede; **nunca causa remoção automática**.

## Garantias de segurança

- Backup `opencode.jsonc.bak-nimsync-<timestamp>` antes de qualquer escrita.
- Edição cirúrgica do JSONC: **seus comentários são preservados**.
- Validação das mudanças com **rollback automático** do backup se a validação falhar.
- `init` é idempotente e nunca sobrescreve um provider existente.
- Somente o mapa `models` do provider selecionado é alterado pelo `update`.
- Sondagem antes de remover: modelo que ainda responde não é removido.
- Timeout e rate-limit nunca removem nada.
- Proveniência separada por provider em `~/.local/state/nimsync/managed.json` (`aihubmix:<id>`; entradas NVIDIA legadas continuam sem prefixo); perfis custom em `~/.local/state/nimsync/profiles.json`.

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
bun src/index.ts providers
bun src/index.ts check --refresh
bun src/index.ts check --provider aihubmix --refresh
```

Notas de engenharia:

- O build.nvidia.com **varia o SSR conforme o browser/UA** — o scraper tenta Firefox, depois Chrome, e por último extrai slugs do payload RSC (`self.__next_f`).
- IDs pontuados (`glm-5.3-flash`) vs slugs do site (`glm-5-3-flash`): comparação por chave normalizada (lowercase, sem `[-._]`).
- Caches em `~/.cache/nimsync/` (TTL 6h), um arquivo por catálogo de provider. Resultados vazios não são cacheados.
- A sondagem usa request mínima real. O `doctor` também mostra quando o provider serve um alias (o campo `model` da resposta difere do ID solicitado).

## Roadmap

- [x] Pacote AUR (`nimsync-bin`, binários do GitHub Release)
- [x] Gerenciador multi-provider (grátis primeiro: Google AI Studio, Groq, OpenRouter, gateways custom)
- [ ] GitHub Actions para release automatizado no tag push
- [ ] Timer systemd semanal + notificação de pendências
- [ ] `--refresh-meta` para atualizar limites de modelos já configurados

## Licença

MIT
