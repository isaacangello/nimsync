**[English](CHANGELOG.md)**

# Changelog

## [Não lançado]

## [0.5.0] - 2026-11-22

### Adicionado

- Gerenciador multi-provider com a filosofia grátis primeiro: Google AI Studio, Groq, OpenRouter e gateways custom OpenAI-compatible
- Novo painel `nimsync providers` com tier, chave detectada e estado da configuração
- `nimsync check` sem `--profile` agora itera todos os providers configurados, grátis primeiro
- `nimsync init` sem flags roda um wizard de onboarding grátis primeiro com instruções passo a passo da chave
- Opt-in `--include-paid` nos provedores freemium e toggle `p` na TUI, com candidatos pagos marcados com `[$]`
- Novo veredito `alive-quota` (HTTP 429 significa vivo, mas com cota/rate-limit) que nunca remove um modelo
- Perfis custom registrados por `init --profile custom` e guardados em `~/.local/state/nimsync/profiles.json`
- Comando `nimsync-stats` com downloads do GitHub Releases, stars/forks do repositório, métricas de adoção no AUR e modo `--watch` com atualização a cada 60 segundos
- Metadados do pacote npm e workflow do GitHub Actions disparado por tags `v*.*.*`, validando e publicando o pacote com provenance usando `NPM_TOKEN`

### Corrigido

- O wizard de onboarding e os prompts interativos não travam mais quando o stdin fecha (EOF encerra graciosamente)
- O script de release agora atualiza os dois changelogs e publica notas de release bilíngues

## [0.4.0] - 2026-11-19

### Adicionado

- Suporte ao AIHubMix como provider customizado `aisdk:@ai-sdk/openai-compatible`, sem alterar o fluxo default NVIDIA NIM
- Novo comando `nimsync init --profile aihubmix`, com edição JSONC cirúrgica, backup, validação e rollback; a operação é idempotente
- Flag `--profile <nvidia|aihubmix>` e inferência automática pelo `--provider aihubmix`
- Whitelist AIHubMix somente de IDs `-free`/`:free` ou custo `0/0` no models.dev; cache do catálogo separado por provider
- Sondagens AIHubMix com `404 model_retired` e `400 no_available_channel` como morte; `403` de saldo insuficiente é reportado como vivo-pago, nunca removido
- Marcador ` ·MIX`, env dedicada `AIHUBMIX_KEY_<MODELO>` e namespace `aihubmix:<id>` na proveniência; entradas NVIDIA legadas permanecem compatíveis
- `doctor` informa o modelo servido pelo upstream quando difere do ID solicitado (aliases)
- Documentação disponível em inglês e português do Brasil, com links recíprocos entre README e changelog

## [0.3.0] - 2026-11-12

### Adicionado

- Marcador ` ·NIM` no nome de exibição dos modelos gerenciados — identificáveis e filtráveis no `/models` do OpenCode
- Novo comando offline `nimsync list` para mostrar a origem dos modelos
- Proveniência em `~/.local/state/nimsync/managed.json`, respeitando renomeações manuais
- Assets da release versionados para evitar colisões de cache de CDN

## [0.2.1] - 2026-11-11

### Corrigido

- TUI: nada vem pré-marcado (nem novos, nem remoção de mortos) e o Enter agora mostra um resumo e exige confirmação `y/n` — um Enter desavisado não modifica mais a config
- Timestamp do backup sem ponto sobrando (`opencode.jsonc.bak-nimsync-<ts>`)
- Banner e `--version` leem a versão do `package.json` no build (mostravam v0.1.0 fixo)

## [0.2.0] - 2026-11-11

### Adicionado

- Descoberta como UNIÃO das fontes (site build.nvidia.com + `/v1/models` + models.dev), com **sondagem real** como árbitro de vida/morte: 404/410 = morto, 200 = vivo, timeout = inconclusivo (nunca removido)
- Parse dos cards do site: badge **Free Endpoint** (elegibilidade ao trial), **Deprecation in Nd** e descrição do card
- Heurística de chat pela descrição para modelos sem catálogo (filtra TTS/embeddings/visão dos recomendados)
- Relatório em 4 seções por confiança de origem, com tags `[site+md] [site] [md] [conta]`
- Mapa slug→ID da API resolvido por sondagem de variantes, com cache em `~/.cache/nimsync/slugmap.json`
- Modelos configurados "fantasmas" (fora de todas as fontes) aparecem no relatório e são sondados

---

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [Versionamento Semântico](https://semver.org/lang/pt-BR/).
