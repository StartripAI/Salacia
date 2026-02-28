#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST_PATH = path.join("third_party", "MANIFEST.json");
const SECRET_PATTERN = /sk-[A-Za-z0-9]{20,}/g;

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function findLicenseFile(files) {
  return files.find((name) => /^LICENSE(\.|$)/i.test(name) || /^NOTICE(\.|$)/i.test(name)) ?? null;
}

async function walkFiles(root) {
  const out = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function scanVendorSecrets(root) {
  const issues = [];
  const files = await walkFiles(root);
  for (const fullPath of files) {
    const relative = path.relative(root, fullPath);
    if (/\.lock$|\.min\./i.test(relative)) continue;
    const content = await fs.readFile(fullPath, "utf8").catch(() => "");
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (SECRET_PATTERN.test(line)) {
        issues.push(`${relative}:${i + 1}: potential secret pattern`);
      }
      SECRET_PATTERN.lastIndex = 0;
    }
  }
  return issues;
}

async function auditVendor(cwd, vendor) {
  const target = path.join(cwd, vendor.targetDir);
  const problems = [];
  const files = await fs.readdir(target).catch(() => null);
  if (!files) {
    problems.push("target directory missing");
    return { name: vendor.name, ok: false, problems };
  }

  const sourceMetaPath = path.join(target, ".source.json");
  const sourceMetaExists = await exists(sourceMetaPath);
  if (!sourceMetaExists) {
    problems.push(".source.json missing");
  }

  if (sourceMetaExists) {
    try {
      const sourceMetaRaw = await fs.readFile(sourceMetaPath, "utf8");
      const sourceMeta = JSON.parse(sourceMetaRaw);
      if (sourceMeta.repo !== vendor.repo) {
        problems.push(`repo mismatch: expected=${vendor.repo} actual=${sourceMeta.repo}`);
      }
      if (sourceMeta.commit !== vendor.commit) {
        problems.push(`commit mismatch: expected=${vendor.commit} actual=${sourceMeta.commit}`);
      }
      if (sourceMeta.license !== vendor.license) {
        problems.push(`license mismatch: expected=${vendor.license} actual=${sourceMeta.license}`);
      }
    } catch (error) {
      problems.push(`invalid .source.json: ${error.message}`);
    }
  }

  const licenseFile = findLicenseFile(files);
  if (!licenseFile) {
    problems.push("LICENSE/NOTICE file missing");
  }

  const allFiles = await walkFiles(target);
  const hasCodeFile = allFiles.some((full) => /\.(ts|tsx|js|mjs|py|go|rs|java|kt|cpp|c|cs)$/i.test(full));
  const hasAnyFiles = files.length > 1;
  if (!hasAnyFiles) {
    problems.push("mirror directory appears empty");
  } else if (!hasCodeFile) {
    problems.push("no code-like files found at mirror root; validate sync depth");
  }

  const secretIssues = await scanVendorSecrets(target);
  if (secretIssues.length > 0) {
    problems.push(`potential secrets found in vendor mirror: ${secretIssues.slice(0, 5).join("; ")}`);
  }

  return {
    name: vendor.name,
    ok: problems.length === 0,
    targetDir: vendor.targetDir,
    problems
  };
}

async function main() {
  const cwd = process.cwd();
  const manifestRaw = await fs.readFile(path.join(cwd, MANIFEST_PATH), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const vendors = Array.isArray(manifest.vendors) ? manifest.vendors : [];

  const checks = [];
  for (const vendor of vendors) {
    checks.push(await auditVendor(cwd, vendor));
  }

  const failed = checks.filter((check) => !check.ok);
  const report = {
    ok: failed.length === 0,
    manifest: MANIFEST_PATH,
    checks,
    failedCount: failed.length
  };

  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
