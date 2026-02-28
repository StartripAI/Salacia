export interface VendorMirrorInfo {
  name: string;
  repo: string;
  commit: string;
  license: string;
  targetDir?: string;
  syncedAt: string;
}

export interface VendorWrapperHealth {
  ok: boolean;
  vendor: string;
  details: string;
  source?: VendorMirrorInfo;
}
