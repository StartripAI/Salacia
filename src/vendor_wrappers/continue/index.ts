import { checkMirrorHealth } from "../shared.js";
import type { VendorWrapperHealth } from "../types.js";

const REPO = "https://github.com/continuedev/continue";
const TARGET_DIR = "third_party/apache/continue";

export async function continueMirrorHealth(cwd = process.cwd()): Promise<VendorWrapperHealth> {
  return checkMirrorHealth(cwd, "continue", TARGET_DIR, REPO);
}
