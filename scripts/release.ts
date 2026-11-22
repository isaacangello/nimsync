#!/usr/bin/env bun
// nimsync release — versionamento semântico (https://semver.org/lang/pt-BR/)
// Uso: bun run release patch|minor|major
//
// 1. bump do version no package.json
// 2. entrada no CHANGELOG.md (EN) e CHANGELOG.pt-BR.md (pt-BR)
// 3. commit "chore(release): vX.Y.Z" + tag
// 4. build binários standalone (bun --compile) + sha256
// 5. GitHub Release via gh (se autenticado)
//
// Flags de conteúdo:
//   --changelog "a; b"          bullets de "Adicionado" (EN)
//   --changelog-fixed "x; y"    bullets de "Corrigido" (EN)
//   --changelog-pt "a; b"       bullets de "Adicionado" (pt-BR)
//   --changelog-pt-fixed "x; y" bullets de "Corrigido" (pt-BR)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const kind = (process.argv[2] ?? "patch") as "patch" | "minor" | "major";
if (!["patch", "minor", "major"].includes(kind)) {
  console.error('uso: bun run release patch|minor|major [--changelog "mudança 1; mudança 2"] [--changelog-pt "..."]');
  process.exit(2);
}

// bullets do changelog/notas: --changelog "a; b; c"
function bulletsOf(flag: string): string[] {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) return [];
  return process.argv[idx + 1]
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const bullets = bulletsOf("--changelog");
const bulletsFixed = bulletsOf("--changelog-fixed");
const bulletsPt = bulletsOf("--changelog-pt");
const bulletsPtFixed = bulletsOf("--changelog-pt-fixed");

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `### ${title}\n\n${items.map((b) => `- ${b}`).join("\n")}`;
}

function entryFor(
  next: string,
  today: string,
  added: string[],
  fixed: string[],
  titles: { added: string; fixed: string } = { added: "Added", fixed: "Fixed" }
): string {
  const body = [
    section(titles.added, added),
    section(titles.fixed, fixed),
  ]
    .filter(Boolean)
    .join("\n\n");
  return `## [${next}] - ${today}\n\n${body || "- (descreva as mudanças desta release)"}\n`;
}

function bump(version: string, k: "patch" | "minor" | "major"): string {
  const [x, y, z] = version.split(".").map(Number);
  if (k === "major") return `${x + 1}.0.0`;
  if (k === "minor") return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
}

const pkgPath = new URL("../package.json", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = bump(pkg.version, kind);

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const today = new Date().toISOString().slice(0, 10);

/**
 * Insere a entrada da versão logo abaixo da seção "Unreleased"/"Não publicado"
 * (ou antes da primeira versão, se não houver), mantendo a ordem cronológica.
 */
function insertEntry(header: string, entry: string): string {
  const lines = header.split("\n");
  const isVersionHeading = (l: string): boolean => /^##\s*\[/.test(l);
  const unreleasedIdx = lines.findIndex((l) =>
    /^##\s*\[(unreleased|não publicado|não lançado|não lancado)\]/i.test(l)
  );
  let insertAt: number;
  if (unreleasedIdx >= 0) {
    const nextSection = lines.findIndex((l, i) => i > unreleasedIdx && isVersionHeading(l));
    insertAt = nextSection >= 0 ? nextSection : lines.length;
  } else {
    const firstSection = lines.findIndex(isVersionHeading);
    insertAt = firstSection >= 0 ? firstSection : lines.length;
  }
  const before = lines.slice(0, insertAt).join("\n").replace(/\n+$/, "");
  const after = lines.slice(insertAt).join("\n").replace(/^\n+/, "");
  return `${before}\n\n${entry}\n${after}`;
}

// CHANGELOG.md (EN)
const changelogPath = new URL("../CHANGELOG.md", import.meta.url).pathname;
let header = `# Changelog\n\nFormato baseado em https://keepachangelog.com/pt-BR/1.1.0/ e SemVer.\n`;
if (existsSync(changelogPath)) header = readFileSync(changelogPath, "utf8");
writeFileSync(
  changelogPath,
  insertEntry(header, entryFor(next, today, bullets, bulletsFixed))
);

// CHANGELOG.pt-BR.md
const changelogPtPath = new URL("../CHANGELOG.pt-BR.md", import.meta.url).pathname;
if (existsSync(changelogPtPath)) {
  const headerPt = readFileSync(changelogPtPath, "utf8");
  writeFileSync(
    changelogPtPath,
    insertEntry(
      headerPt,
      entryFor(next, today, bulletsPt, bulletsPtFixed, { added: "Adicionado", fixed: "Corrigido" })
    )
  );
}

const sh = (cmd: string) => {
  console.log(`$ ${cmd}`);
  const p = Bun.spawnSync(["bash", "-c", cmd], { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
};

sh(`git add package.json CHANGELOG.md CHANGELOG.pt-BR.md`);
sh(`git commit -m "chore(release): v${next}"`);
sh(`git tag "v${next}"`);

// binários standalone — nomes VERSIONADOS (evita colisão de cache de CDN do
// GitHub quando uma release é recriada com o mesmo nome de asset)
mkdirSync("dist", { recursive: true });
sh(`rm -f dist/nimsync-* dist/SHA256SUMS`);
for (const target of ["bun-linux-x64", "bun-linux-arm64"]) {
  const arch = target.endsWith("x64") ? "x64" : "arm64";
  sh(`bun build --compile --target=${target} --outfile dist/nimsync-${next}-linux-${arch} src/index.ts`);
}
sh(`cd dist && sha256sum nimsync-*-linux-* > SHA256SUMS`);
sh(`git push origin main --tags`);

// release no GitHub (se o repositório remoto existir)
const remote = Bun.spawnSync(["bash", "-c", "git remote get-url origin"]).stdout.toString().trim();
if (remote) {
  const repo = "https://github.com/isaacangello/nimsync";
  const enBlock = [
    bullets.length ? `### Added\n\n${bullets.map((b) => `- ${b}`).join("\n")}` : "",
    bulletsFixed.length ? `### Fixed\n\n${bulletsFixed.map((b) => `- ${b}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const ptBlock = [
    bulletsPt.length ? `### Adicionado\n\n${bulletsPt.map((b) => `- ${b}`).join("\n")}` : "",
    bulletsPtFixed.length ? `### Corrigido\n\n${bulletsPtFixed.map((b) => `- ${b}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const notes = [
    enBlock ? `## English\n\n${enBlock}` : "",
    ptBlock ? `## Português (BR)\n\n${ptBlock}` : "",
    `See / veja: [CHANGELOG](${repo}/blob/v${next}/CHANGELOG.md) · [CHANGELOG em português](${repo}/blob/v${next}/CHANGELOG.pt-BR.md)`,
  ]
    .filter(Boolean)
    .join("\n\n");
  writeFileSync(new URL("../dist/NOTES.md", import.meta.url).pathname, `${notes}\n`);
  sh(
    `gh release create v${next} dist/nimsync-${next}-linux-x64 dist/nimsync-${next}-linux-arm64 dist/SHA256SUMS --title "v${next}" --notes-file dist/NOTES.md --verify-tag`
  );
  console.log(`\n✓ release v${next} publicada`);
} else {
  console.log(`\n⚠ sem remote origin — release local criada (tag v${next}), binários em dist/`);
}
console.log(`\n✓ v${next} — próximo passo AUR: atualizar pkgver do PKGBUILD e sha256sums`);
