# nimsync

> Sincroniza o catálogo NVIDIA NIM (build.nvidia.com) com a whitelist de modelos do seu OpenCode.

Descobre **modelos novos** que apareceram na sua conta, detecta os que **morreram** e avisa dos que estão **deprecando** — com cards "Deprecation in Nd" contando os dias.

## Por quê?

A lista de modelos da NVIDIA muda o tempo todo: o Kimi K3 foi descontinuado com o usuário configurado; o GLM 5.3 saiu do catálogo mas continua servindo (sunset); sucessores já nascem marcados como deprecated. Fazer isso na mão é dor.

## Instalação

```bash
bun install
ln -sf "$(pwd)/src/index.ts" ~/.local/bin/nimsync   # comando global
```

## Uso

| Comando | O que faz | Escreve na config? |
|---|---|---|
| `nimsync` | TUI interativa (checkboxes, cursor, aplicar) | só com `enter` |
| `nimsync check` | relatório de novos/mortos/deprecando | **nunca** |
| `nimsync update` | aplica mudanças (prompts se TTY) | sim, com backup |
| `nimsync update --yes --all` | remove mortos + adiciona todos os novos chat | sim, com backup |
| `nimsync update --yes` | conservador: remove só mortos confirmados | sim, com backup |
| `nimsync update --dry-run` | prévia da config resultante | não |
| `nimsync doctor` | request mínima por modelo configurado (chave, latência, rota viva?) | não |

Flags: `--config <path>` · `--provider <id>` · `--refresh` (ignora cache 6h) · `--json` · `--timeout-ms <n>`

## Como decide (as 3 fontes)

```
1. /v1/models na SUA conta (autoritativo)   → modelo fora daqui = candidato a morto
2. models.dev/api.json (fonte do OpenCode)  → limites reais, reasoning_effort válido, tool_call, status
3. build.nvidia.com (cards da listagem)     → badge "Deprecation in Nd" com contagem de dias
```

Classificação:

- **NOVO** — na conta + no models.dev (com `tool_call`/`reasoning`) + fora da config
- **MORTO** — na config, sumiu da conta **e** a sondagem confirmou (sem resposta)
- **DEPRECANDO** — badge do site, `status: deprecated` no models.dev, ou *sunset* (fora do catálogo mas ainda responde — caso GLM 5.3 em nov/2026)
- **NUNCA remove por evidência inconclusiva** (timeout/fila) — degrada para DEPRECANDO

## Garantias de segurança

- Backup `opencode.jsonc.bak-nimsync-<timestamp>` antes de qualquer escrita
- Edição cirúrgica do JSONC: **seus comentários são preservados** byte a byte
- Validação pós-escrita com **rollback automático** do backup se algo sair do trilho
- Só mexe no provider detectado pelo baseURL do NIM (`nvidia-nim`), nada mais
- Sondagem antes de remover: modelo que ainda responde não é removido

## Versionamento

[SemVer 2.0.0](https://semver.org/lang/pt-BR/) — MAJOR quebra interface, MINOR adiciona feature, PATCH corrige. Commits no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/).

```bash
bun run release patch   # 0.1.0 -> 0.1.1: bump, tag, build, GitHub Release
bun run release minor   # 0.1.0 -> 0.2.0
```

## Desenvolvimento

```bash
bun install
bun run typecheck
bun src/index.ts check --refresh
```

Notas de engenharia (batalhas ganhas):

- O build.nvidia.com **varia o SSR conforme o browser/UA** — o scraper tenta Firefox, depois Chrome, e por último extrai slugs do payload RSC (`self.__next_f`), que existe independente do render.
- IDs pontuados (`glm-5.3-flash`) vs slugs do site (`glm-5-3-flash`): comparação por chave normalizada (lowercase, sem `[-._]`).
- Cache das fontes em `~/.cache/nimsync/` (TTL 6h) — nunca cacheia resultado vazio.
- A sondagem usa request mínima real: modelos com reasoning pesado podem ultrapassar o timeout — e aí a resposta é "inconclusivo", nunca "morto".

## Roadmap

- [ ] Pacote AUR (`nimsync-bin`, binários do GitHub Release) — após validação do fluxo
- [ ] GitHub Actions para release automatizado no tag push
- [ ] Timer systemd semanal + notificação de pendências
- [ ] `--refresh-meta` para atualizar limites de modelos já configurados

## Licença

MIT
