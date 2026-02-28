import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attestRun, buildManifest } from "../src/benchmark/attest.js";
import { verifyRunAttestation } from "../src/benchmark/verify.js";

describe("benchmark attestation", () => {
  it("supports explicit keyDir and verifies roundtrip", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-attest-"));
    const runDir = path.join(root, "run");
    const keyDir = path.join(root, "keys");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify({ ok: true }), "utf8");

    const attestation = await attestRun(runDir, { keyDir });
    expect(attestation.publicKeyPath.startsWith(keyDir)).toBe(true);

    const verification = await verifyRunAttestation(runDir, { keyDir });
    expect(verification.ok).toBe(true);
    expect(verification.manifestVerified).toBe(true);
    expect(verification.signatureVerified).toBe(true);
  });

  it("fails verification when attested file is modified", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-attest-tamper-"));
    const runDir = path.join(root, "run");
    const keyDir = path.join(root, "keys");
    await fs.mkdir(runDir, { recursive: true });
    const reportPath = path.join(runDir, "report.json");
    await fs.writeFile(reportPath, JSON.stringify({ ok: true }), "utf8");

    await attestRun(runDir, { keyDir });
    await fs.writeFile(reportPath, JSON.stringify({ ok: false, tampered: true }), "utf8");

    const verification = await verifyRunAttestation(runDir, { keyDir });
    expect(verification.ok).toBe(false);
    expect(verification.hashMismatches.length).toBeGreaterThan(0);
  });

  it("includes symlinked files in manifest coverage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-attest-symlink-"));
    const runDir = path.join(root, "run");
    await fs.mkdir(runDir, { recursive: true });

    const reportPath = path.join(runDir, "report.json");
    const linkPath = path.join(runDir, "report-link.json");
    await fs.writeFile(reportPath, JSON.stringify({ ok: true }), "utf8");
    try {
      await fs.symlink(reportPath, linkPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        // Some CI hosts disallow symlink creation; skip this case.
        expect(true).toBe(true);
        return;
      }
      throw error;
    }

    const manifestPath = path.join(runDir, "manifest.sha256");
    const payload = await buildManifest(runDir, manifestPath);
    const files = payload.entries.map((entry) => entry.file);
    expect(files.includes("report.json")).toBe(true);
    expect(files.includes("report-link.json")).toBe(true);
  });
});
