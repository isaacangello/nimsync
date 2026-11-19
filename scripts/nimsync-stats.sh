#!/usr/bin/env bash
#
# nimsync-stats — monitor de adoção do pacote nimsync
# Mostra downloads do GitHub Releases + métricas do repositório e do AUR.
#
# Uso: nimsync-stats [--watch]
#   --watch  atualiza a cada 60 segundos (Ctrl+C para sair)
#

set -euo pipefail

REPO="isaacangello/nimsync"
AUR_PKG="nimsync-bin"

usage() {
    cat <<'EOF'
nimsync-stats — estatísticas de adoção do nimsync

USO
  nimsync-stats            consulta e mostra o relatório uma vez
  nimsync-stats --watch    atualiza a cada 60 segundos (Ctrl+C para sair)
  nimsync-stats --help     mostra esta ajuda

DEPENDÊNCIAS
  gh (GitHub CLI), jq e curl

FONTES
  GitHub Releases: downloads por asset e total
  GitHub repo:     stars e forks
  AUR:             votos, popularidade e flag out-of-date
EOF
}

cores() {
    # Detecta se o terminal suporta cores.
    [ -t 1 ] && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]
}

if cores; then
    BOLD="\033[1m"
    DIM="\033[2m"
    GREEN="\033[32m"
    CYAN="\033[36m"
    YELLOW="\033[33m"
    RESET="\033[0m"
else
    BOLD="" DIM="" GREEN="" CYAN="" YELLOW="" RESET=""
fi

show_stats() {
    # ── GitHub Release downloads ──────────────────────────────
    local gh_json dl_total dl_assets
    gh_json=$(gh api "repos/$REPO/releases" 2>/dev/null) || {
        echo -e "${YELLOW}⚠ Não foi possível consultar o GitHub (gh autenticado?)${RESET}" >&2
        gh_json="[]"
    }

    dl_total=$(echo "$gh_json" | jq '[.[].assets[].download_count] | add // 0')
    dl_assets=$(echo "$gh_json" | jq -r '
        .[] | .tag_name as $tag
        | .assets[]
        | select(.download_count > 0)
        | "  \($tag) / \(.name): \(.download_count)"
    ' 2>/dev/null)

    # ── GitHub repo stats ──────────────────────────────────────
    local stars forks
    stars=$(gh api "repos/$REPO" --jq '.stargazers_count' 2>/dev/null || echo "?")
    forks=$(gh api "repos/$REPO" --jq '.forks_count' 2>/dev/null || echo "?")

    # ── AUR ────────────────────────────────────────────────────
    local aur_json votes pop ood
    aur_json=$(curl -fsS "https://aur.archlinux.org/rpc/v5/info?arg[]=$AUR_PKG" 2>/dev/null) || {
        echo -e "${YELLOW}⚠ Não foi possível consultar o AUR${RESET}" >&2
        aur_json='{"results":[]}'
    }
    votes=$(echo "$aur_json" | jq -r '.results[0].NumVotes // 0')
    pop=$(echo "$aur_json" | jq -r '.results[0].Popularity // 0')
    ood=$(echo "$aur_json" | jq -r '.results[0].OutOfDate // "null"')

    # ── Render ────────────────────────────────────────────────
    clear 2>/dev/null || true
    echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}  nimsync — estatísticas de adoção${RESET}"
    echo -e "${DIM}  $(date '+%d/%m/%Y %H:%M:%S')${RESET}"
    echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
    echo
    echo -e "${CYAN}${BOLD}📥 GitHub Releases (builds do pacote)${RESET}"
    echo -e "  Downloads totais:  ${GREEN}${BOLD}${dl_total}${RESET}"
    if [ -n "$dl_assets" ]; then
        echo -e "$dl_assets" | while read -r line; do echo -e "  ${DIM}${line}${RESET}"; done
    else
        echo -e "  ${DIM}(nenhum asset com downloads ainda)${RESET}"
    fi
    echo
    echo -e "${CYAN}${BOLD}⭐ GitHub repo${RESET}"
    echo -e "  Stars:  ${stars}"
    echo -e "  Forks:  ${forks}"
    echo
    echo -e "${CYAN}${BOLD}🗳  AUR ($AUR_PKG)${RESET}"
    echo -e "  Votos:        ${votes}"
    echo -e "  Popularidade: ${pop}"
    if [ "$ood" != "null" ] && [ -n "$ood" ]; then
        echo -e "  ${YELLOW}⚠ Marcado como out-of-date!${RESET}"
    fi
    echo
    echo -e "${BOLD}───────────────────────────────────────────────${RESET}"
    echo -e "${DIM}  Links:${RESET}"
    echo -e "  ${DIM}AUR:      https://aur.archlinux.org/packages/$AUR_PKG${RESET}"
    echo -e "  ${DIM}Releases: https://github.com/$REPO/releases${RESET}"
    echo -e "  ${DIM}Traffic:  https://github.com/$REPO/pulse${RESET}"
    echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
}

# ── Main ──────────────────────────────────────────────────────
case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    ""|--watch)
        ;;
    *)
        echo "Erro: opção desconhecida: $1 (use --help)" >&2
        exit 2
        ;;
esac

command -v gh >/dev/null 2>&1 || { echo "Erro: gh (GitHub CLI) não instalado" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Erro: jq não instalado" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Erro: curl não instalado" >&2; exit 1; }

if [ "${1:-}" = "--watch" ]; then
    while true; do
        show_stats
        sleep 60
    done
else
    show_stats
fi
