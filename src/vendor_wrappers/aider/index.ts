import { checkMirrorHealth } from "../shared.js";
import type { VendorWrapperHealth } from "../types.js";

const REPO = "https://github.com/Aider-AI/aider";
const TARGET_DIR = "third_party/apache/aider";

export async function aiderMirrorHealth(cwd = process.cwd()): Promise<VendorWrapperHealth> {
  return checkMirrorHealth(cwd, "aider", TARGET_DIR, REPO);
}
