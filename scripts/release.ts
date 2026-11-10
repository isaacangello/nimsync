#!/usr/bin/env bun
// nimsync release — versionamento semântico (https://semver.org/lang/pt-BR/)
// Uso: bun run release patch|minor|major
//
// 1. bump do version no package.json
// 2. entrada no CHANGELOG.md
// 3. commit "chore(release): vX.Y.Z" + tag
// 4. build binários standalone (bun --compile) + sha256
// 5. GitHub Release via gh (se autenticado)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const kind = (process.argv[2] ?? "patch") as "patch" | "minor" | "major";
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("uso: bun run release patch|minor|major");
  process.exit(2);
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

// CHANGELOG.md
const changelogPath = new URL("../CHANGELOG.md", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);
let header = `# Changelog\n\nFormato baseado em https://keepachangelog.com/pt-BR/1.1.0/ e SemVer.\n`;
if (existsSync(changelogPath)) header = readFileSync(changelogPath, "utf8");
const entry = `## [${next}] - ${today}\n\n- ${kind === "major" ? "BREAKING: " : ""}(descreva as mudanças desta release)\n`;
if (header.includes("# Changelog")) {
  const afterHeader = header.indexOf("\n", header.indexOf("# Changelog")) + 1;
  writeFileSync(changelogPath, `${header.slice(0, afterHeader)}\n${entry}${header.slice(afterHeader)}`);
} else {
  writeFileSync(changelogPath, `${header}\n${entry}`);
}

const sh = (cmd: string) => {
  console.log(`$ ${cmd}`);
  const p = Bun.spawnSync(["bash", "-c", cmd], { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
};

sh(`git add package.json CHANGELOG.md`);
sh(`git commit -m "chore(release): v${next}"`);
sh(`git tag "v${next}"`);

// binários standalone
mkdirSync("dist", { recursive: true });
for (const target of ["bun-linux-x64", "bun-linux-arm64"]) {
  const arch = target.endsWith("x64") ? "x64" : "arm64";
  sh(`bun build --compile --target=${target} --outfile dist/nimsync-linux-${arch} src/index.ts`);
}
sh(`cd dist && sha256sum nimsync-linux-* > SHA256SUMS`);
sh(`git push origin main --tags`);

// release no GitHub (se o repositório remoto existir)
const remote = Bun.spawnSync(["bash", "-c", "git remote get-url origin"]).stdout.toString().trim();
if (remote) {
  sh(
    `gh release create v${next} dist/nimsync-linux-x64 dist/nimsync-linux-arm64 dist/SHA256SUMS --title "v${next}" --notes "Veja CHANGELOG.md" --verify-tag`
  );
  console.log(`\n✓ release v${next} publicada`);
} else {
  console.log(`\n⚠ sem remote origin — release local criada (tag v${next}), binários em dist/`);
}
console.log(`\n✓ v${next} — próximo passo AUR: atualizar pkgver do PKGBUILD e sha256sums`);
