#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const SECRET_PATTERN = /sk-[A-Za-z0-9]{20,}/g;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".salacia"]);
const SKIP_FILES = new Set(["package-lock.json"]);

async function walk(dir, root, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, root, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    out.push({ full, rel });
  }
}

async function main() {
  const cwd = process.cwd();
  const files = [];
  await walk(cwd, cwd, files);

  const matches = [];
  for (const file of files) {
    let content = "";
    try {
      content = await fs.readFile(file.full, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (SECRET_PATTERN.test(line)) {
        matches.push(`${file.rel}:${i + 1}: potential secret`);
      }
      SECRET_PATTERN.lastIndex = 0;
    }
  }

  if (matches.length > 0) {
    console.error(matches.join("\n"));
    process.exit(1);
  }

  console.log("No matching secrets found");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
