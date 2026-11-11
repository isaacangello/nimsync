# Changelog

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

Formato baseado em https://keepachangelog.com/pt-BR/1.1.0/ e SemVer.
