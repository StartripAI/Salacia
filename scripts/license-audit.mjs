#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST_PATH = path.join("third_party", "MANIFEST.json");
const REQUIRED_DOCS = [
  "THIRD_PARTY_NOTICES.md",
  path.join("docs", "compliance", "SOURCE_ATTRIBUTION.md"),
  path.join("docs", "compliance", "LICENSE_COMPATIBILITY.md"),
  path.join("docs", "compliance", "THIRD_PARTY_NOTICES.md")
];

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function main() {
  const cwd = process.cwd();
  const report = {
    ok: true,
    checks: [],
    failures: []
  };

  const rootLicensePath = path.join(cwd, "LICENSE");
  const rootLicenseOk = await exists(rootLicensePath);
  report.checks.push({
    name: "root-license",
    ok: rootLicenseOk,
    details: rootLicenseOk ? "LICENSE present" : "LICENSE missing"
  });
  if (!rootLicenseOk) {
    report.failures.push("missing root LICENSE");
  }

  for (const rel of REQUIRED_DOCS) {
    const ok = await exists(path.join(cwd, rel));
    report.checks.push({
      name: `doc:${rel}`,
      ok,
      details: ok ? "present" : "missing"
    });
    if (!ok) {
      report.failures.push(`missing required document: ${rel}`);
    }
  }

  const manifestRaw = await fs.readFile(path.join(cwd, MANIFEST_PATH), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const vendors = Array.isArray(manifest.vendors) ? manifest.vendors : [];
  const noticesRaw = await fs.readFile(path.join(cwd, "THIRD_PARTY_NOTICES.md"), "utf8").catch(() => "");

  for (const vendor of vendors) {
    const targetDir = path.join(cwd, vendor.targetDir);
    const dirExists = await exists(targetDir);
    const licenseFiles = dirExists ? await fs.readdir(targetDir).catch(() => []) : [];
    const hasLicense = licenseFiles.some((name) => /^LICENSE(\.|$)/i.test(name) || /^NOTICE(\.|$)/i.test(name));
    const inNotice = noticesRaw.includes(vendor.name) && noticesRaw.includes(vendor.repo);
    const agplBlocked = String(vendor.license).toUpperCase().includes("AGPL");

    report.checks.push({
      name: `vendor:${vendor.name}`,
      ok: dirExists && hasLicense && inNotice && !agplBlocked,
      details: `dir=${dirExists} license=${hasLicense} notice=${inNotice} agplBlocked=${agplBlocked}`
    });

    if (!dirExists) report.failures.push(`vendor dir missing: ${vendor.targetDir}`);
    if (!hasLicense) report.failures.push(`vendor license missing: ${vendor.name}`);
    if (!inNotice) report.failures.push(`vendor notice missing: ${vendor.name}`);
    if (agplBlocked) report.failures.push(`AGPL vendor forbidden in mirror path: ${vendor.name}`);
  }

  report.ok = report.failures.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
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
