import { createHash, verify as verifySignature } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BenchmarkAttestation } from "../core/types.js";

const execFileAsync = promisify(execFile);

export interface BenchmarkVerifyResult {
  ok: boolean;
  manifestVerified: boolean;
  signatureVerified: boolean;
  missingFiles: string[];
  hashMismatches: string[];
  attestationMethod: BenchmarkAttestation["method"] | "unknown";
  details: string[];
}

export interface VerifyRunAttestationOptions {
  keyDir: string;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function parseManifest(manifestPath: string): Promise<Array<{ sha256: string; file: string }>> {
  const raw = await fs.readFile(manifestPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/i);
      if (!match) {
        throw new Error(`Invalid manifest line: ${line}`);
      }
      return {
        sha256: match[1] ?? "",
        file: match[2] ?? ""
      };
    });
}

async function verifyManifest(runDir: string, manifestPath: string): Promise<{
  ok: boolean;
  missingFiles: string[];
  hashMismatches: string[];
}> {
  const entries = await parseManifest(manifestPath);
  const missingFiles: string[] = [];
  const hashMismatches: string[] = [];

  for (const entry of entries) {
    const filePath = path.join(runDir, entry.file);
    const exists = await fs
      .stat(filePath)
      .then((st) => st.isFile())
      .catch(() => false);
    if (!exists) {
      missingFiles.push(entry.file);
      continue;
    }

    const digest = await hashFile(filePath);
    if (digest !== entry.sha256) {
      hashMismatches.push(entry.file);
    }
  }

  return {
    ok: missingFiles.length === 0 && hashMismatches.length === 0,
    missingFiles,
    hashMismatches
  };
}

async function verifyWithMinisign(
  manifestPath: string,
  signaturePath: string,
  publicKeyPath: string
): Promise<boolean> {
  try {
    await execFileAsync("minisign", ["-V", "-m", manifestPath, "-x", signaturePath, "-p", publicKeyPath], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyWithEd25519(signaturePath: string, manifestPath: string, publicKeyPath: string): Promise<boolean> {
  try {
    const [signatureRaw, manifest, publicKeyPem] = await Promise.all([
      fs.readFile(signaturePath, "utf8"),
      fs.readFile(manifestPath),
      fs.readFile(publicKeyPath, "utf8")
    ]);
    const payload = JSON.parse(signatureRaw) as Partial<{ algorithm: string; signature: string }>;
    if (payload.algorithm !== "ed25519" || !payload.signature) {
      return false;
    }
    return verifySignature(null, manifest, publicKeyPem, Buffer.from(payload.signature, "base64"));
  } catch {
    return false;
  }
}

export async function verifyRunAttestation(
  runDir: string,
  options: VerifyRunAttestationOptions
): Promise<BenchmarkVerifyResult> {
  const manifestPath = path.join(runDir, "manifest.sha256");
  const minisignSignaturePath = path.join(runDir, "attestation.minisig");
  const ed25519SignaturePath = path.join(runDir, "attestation.ed25519.json");
  const keyDir = options.keyDir;
  const minisignPublicKeyPath = path.join(keyDir, "minisign.pub");
  const ed25519PublicKeyPath = path.join(keyDir, "ed25519.pub.pem");

  const details: string[] = [];
  const manifestExists = await fs
    .access(manifestPath)
    .then(() => true)
    .catch(() => false);
  const minisignSignatureExists = await fs
    .access(minisignSignaturePath)
    .then(() => true)
    .catch(() => false);
  const ed25519SignatureExists = await fs
    .access(ed25519SignaturePath)
    .then(() => true)
    .catch(() => false);
  const signatureExists = minisignSignatureExists || ed25519SignatureExists;

  if (!manifestExists || !signatureExists) {
    const missingFiles: string[] = [];
    if (!manifestExists) missingFiles.push("manifest.sha256");
    if (!signatureExists) missingFiles.push("attestation.minisig|attestation.ed25519.json");
    return {
      ok: false,
      manifestVerified: false,
      signatureVerified: false,
      missingFiles,
      hashMismatches: [],
      attestationMethod: "unknown",
      details: ["Missing manifest or signature file."]
    };
  }

  const manifestResult = await verifyManifest(runDir, manifestPath);
  details.push(
    manifestResult.ok
      ? "Manifest hash verification passed."
      : `Manifest verification failed (missing=${manifestResult.missingFiles.length}, mismatch=${manifestResult.hashMismatches.length}).`
  );

  let signatureVerified = false;
  let attestationMethod: BenchmarkVerifyResult["attestationMethod"] = "unknown";

  const minisignKeyExists = await fs
    .access(minisignPublicKeyPath)
    .then(() => true)
    .catch(() => false);
  if (minisignKeyExists && minisignSignatureExists) {
    signatureVerified = await verifyWithMinisign(manifestPath, minisignSignaturePath, minisignPublicKeyPath);
    if (signatureVerified) {
      attestationMethod = "minisign";
      details.push("Signature verified with minisign.");
    }
  }

  if (!signatureVerified) {
    const edKeyExists = await fs
      .access(ed25519PublicKeyPath)
      .then(() => true)
      .catch(() => false);
    if (edKeyExists && ed25519SignatureExists) {
      signatureVerified = await verifyWithEd25519(ed25519SignaturePath, manifestPath, ed25519PublicKeyPath);
      attestationMethod = "ed25519";
      details.push(signatureVerified ? "Signature verified with ed25519." : "ed25519 signature verification failed.");
    } else {
      details.push("No public key found for signature verification.");
    }
  }

  const ok = manifestResult.ok && signatureVerified;
  return {
    ok,
    manifestVerified: manifestResult.ok,
    signatureVerified,
    missingFiles: manifestResult.missingFiles,
    hashMismatches: manifestResult.hashMismatches,
    attestationMethod,
    details
  };
}
