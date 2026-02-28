import { checkMirrorHealth } from "../shared.js";
import type { VendorWrapperHealth } from "../types.js";

const REPO = "https://github.com/cline/cline";
const TARGET_DIR = "third_party/apache/cline";

export async function clineMirrorHealth(cwd = process.cwd()): Promise<VendorWrapperHealth> {
  return checkMirrorHealth(cwd, "cline", TARGET_DIR, REPO);
}
