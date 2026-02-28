import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BenchmarkAttestation } from "../core/types.js";
import { commandExists } from "../core/client-endpoints.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ManifestEntry {
  file: string;
  sha256: string;
}

interface ManifestPayload {
  generatedAt: string;
  entries: ManifestEntry[];
}

export interface AttestRunOptions {
  keyDir: string;
}

async function exists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    } else if (entry.isSymbolicLink()) {
      // Include symlinked files in manifest coverage; skip symlinked directories to avoid cycles.
      const resolved = await fs.realpath(full).catch(() => null);
      if (!resolved) {
        continue;
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat?.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

export async function buildManifest(runDir: string, manifestPath: string): Promise<ManifestPayload> {
  const files = await walkFiles(runDir);
  const filtered = files.filter((filePath) => {
    const base = path.basename(filePath);
    return base !== "manifest.sha256" && base !== "attestation.minisig" && base !== "attestation.ed25519.json";
  });

  const entries: ManifestEntry[] = [];
  for (const filePath of filtered.sort()) {
    entries.push({
      file: path.relative(runDir, filePath),
      sha256: await hashFile(filePath)
    });
  }

  const payload: ManifestPayload = {
    generatedAt: new Date().toISOString(),
    entries
  };
  const lines = payload.entries.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n");
  await fs.writeFile(manifestPath, lines.length > 0 ? `${lines}\n` : "", "utf8");
  return payload;
}

async function ensureMinisignKeys(keyDir: string): Promise<{ publicKeyPath: string; secretKeyPath: string }> {
  await fs.mkdir(keyDir, { recursive: true });
  const publicKeyPath = path.join(keyDir, "minisign.pub");
  const secretKeyPath = path.join(keyDir, "minisign.key");
  const hasPublic = await exists(publicKeyPath);
  const hasSecret = await exists(secretKeyPath);
  if (hasPublic && hasSecret) {
    return { publicKeyPath, secretKeyPath };
  }

  await execFileAsync("minisign", ["-G", "-p", publicKeyPath, "-s", secretKeyPath, "-W"], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  return { publicKeyPath, secretKeyPath };
}

async function signWithMinisign(
  manifestPath: string,
  signaturePath: string,
  keyDir: string
): Promise<BenchmarkAttestation> {
  const keys = await ensureMinisignKeys(keyDir);
  await execFileAsync("minisign", ["-S", "-s", keys.secretKeyPath, "-m", manifestPath, "-x", signaturePath], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });

  return {
    method: "minisign",
    manifestPath,
    signaturePath,
    publicKeyPath: keys.publicKeyPath
  };
}

async function ensureEd25519Keys(keyDir: string): Promise<{ publicKeyPath: string; privateKeyPath: string }> {
  await fs.mkdir(keyDir, { recursive: true });
  const publicKeyPath = path.join(keyDir, "ed25519.pub.pem");
  const privateKeyPath = path.join(keyDir, "ed25519.key.pem");
  const hasPublic = await exists(publicKeyPath);
  const hasPrivate = await exists(privateKeyPath);

  if (hasPublic && hasPrivate) {
    return { publicKeyPath, privateKeyPath };
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  await fs.writeFile(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");
  await fs.writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");
  return { publicKeyPath, privateKeyPath };
}

async function signWithEd25519(
  manifestPath: string,
  signaturePath: string,
  keyDir: string
): Promise<BenchmarkAttestation> {
  const keys = await ensureEd25519Keys(keyDir);
  const [manifest, privateKeyPem] = await Promise.all([
    fs.readFile(manifestPath),
    fs.readFile(keys.privateKeyPath, "utf8")
  ]);
  const signature = sign(null, manifest, privateKeyPem).toString("base64");
  await fs.writeFile(
    signaturePath,
    JSON.stringify(
      {
        algorithm: "ed25519",
        signature
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    method: "ed25519",
    manifestPath,
    signaturePath,
    publicKeyPath: keys.publicKeyPath
  };
}

export async function attestRun(runDir: string, options: AttestRunOptions): Promise<BenchmarkAttestation> {
  const manifestPath = path.join(runDir, "manifest.sha256");
  const minisignSignaturePath = path.join(runDir, "attestation.minisig");
  const ed25519SignaturePath = path.join(runDir, "attestation.ed25519.json");
  await buildManifest(runDir, manifestPath);

  const keyDir = options.keyDir;
  const minisignAvailable = await commandExists("minisign");
  if (minisignAvailable) {
    try {
      return await signWithMinisign(manifestPath, minisignSignaturePath, keyDir);
    } catch {
      // Fall through to ed25519 fallback.
    }
  }

  return signWithEd25519(manifestPath, ed25519SignaturePath, keyDir);
}
