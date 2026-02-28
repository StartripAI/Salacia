#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MANIFEST_PATH = path.join("third_party", "MANIFEST.json");
const ALLOWED_LICENSES = new Set(["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause"]);

function parseArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function run(cmd, args, cwd) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024
  });
  return `${stdout}\n${stderr}`.trim();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
  }
}

function pickLicenseFile(files) {
  const candidates = files.filter((file) => /^LICENSE(\.|$)/i.test(file) || /^NOTICE(\.|$)/i.test(file));
  return candidates[0] ?? null;
}

async function syncVendor(cwd, vendor, dryRun) {
  if (!ALLOWED_LICENSES.has(vendor.license)) {
    throw new Error(`Blocked vendor ${vendor.name}: unsupported license ${vendor.license}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-vendor-"));
  const checkoutDir = path.join(tempRoot, vendor.name);
  await fs.mkdir(checkoutDir, { recursive: true });

  await run("git", ["init"], checkoutDir);
  await run("git", ["remote", "add", "origin", vendor.repo], checkoutDir);
  await run("git", ["fetch", "--depth", "1", "origin", vendor.commit], checkoutDir);
  await run("git", ["checkout", "FETCH_HEAD"], checkoutDir);

  const rootFiles = await fs.readdir(checkoutDir).catch(() => []);
  const licenseCandidate = pickLicenseFile(rootFiles);
  if (!licenseCandidate) {
    throw new Error(`Vendor ${vendor.name}: no LICENSE/NOTICE found in upstream checkout`);
  }

  const targetDir = path.resolve(cwd, vendor.targetDir);
  const sourceMeta = {
    name: vendor.name,
    repo: vendor.repo,
    commit: vendor.commit,
    license: vendor.license,
    syncedAt: new Date().toISOString()
  };

  if (!dryRun) {
    await fs.rm(targetDir, { recursive: true, force: true });
    await copyDir(checkoutDir, targetDir);
    await fs.writeFile(path.join(targetDir, ".source.json"), JSON.stringify(sourceMeta, null, 2), "utf8");
  }

  const fileCount = (await fs.readdir(checkoutDir, { recursive: true }).catch(() => [])).length;
  await fs.rm(tempRoot, { recursive: true, force: true });
  return {
    name: vendor.name,
    targetDir: vendor.targetDir,
    commit: vendor.commit,
    license: vendor.license,
    dryRun,
    fileCount
  };
}

async function main() {
  const cwd = process.cwd();
  const only = parseArg("--only");
  const dryRun = hasFlag("--dry-run");
  const onlySet = new Set((only ?? "").split(",").map((item) => item.trim()).filter(Boolean));

  const manifestRaw = await fs.readFile(path.join(cwd, MANIFEST_PATH), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const vendors = Array.isArray(manifest.vendors) ? manifest.vendors : [];
  const selected = onlySet.size > 0 ? vendors.filter((vendor) => onlySet.has(vendor.name)) : vendors;
  if (selected.length === 0) {
    throw new Error("No vendors selected for sync.");
  }

  const results = [];
  for (const vendor of selected) {
    results.push(await syncVendor(cwd, vendor, dryRun));
  }

  const report = {
    ok: true,
    manifest: MANIFEST_PATH,
    dryRun,
    synced: results,
    count: results.length
  };
  console.log(JSON.stringify(report, null, 2));
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
