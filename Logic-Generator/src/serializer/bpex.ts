// .bpex sidecar — a fixed-size zero blob unless whiteboard/extra data is present.
// For logic circuits we emit 192 KiB of zeros (scratch/REPORT.md notes 96K/192K
// variants; 192 KiB is the safe superset).

export const BPEX_SIZE = 192 * 1024;

export function buildBpex(): Uint8Array {
  return new Uint8Array(BPEX_SIZE);
}
