import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getSalaciaPaths } from "../core/paths.js";

export interface EvidenceRecord {
  kind: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export async function writeEvidence(record: EvidenceRecord, cwd = process.cwd()): Promise<string> {
  const dir = path.join(getSalaciaPaths(cwd).journal, "evidence");
  await fs.mkdir(dir, { recursive: true });
  const digest = createHash("sha256")
    .update(JSON.stringify(record))
    .digest("hex")
    .slice(0, 12);
  const filePath = path.join(dir, `${record.kind}-${Date.now()}-${digest}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  return filePath;
}
