// Minimal .bp reader for the calibration tests: every record's prefab, decoded
// `_gt`, and the trailing int32 that follows the struct.
//
// Record grammar (GT_REPORT_v2.md): prefab(8) | idx(4) | data(sizeof) | trailing(4),
// with `_gt` at data+0x14. Struct sizes come from the file's own schema header.

import { readFileSync } from "node:fs";
import { unpackGt, type GtFields } from "../serializer/gtCodec";

const DATA = new URL("../../../data/", import.meta.url);
const GT_DATA_OFFSET = 0x14;

export interface BpRecord {
  prefab: bigint;
  gt: GtFields;
  trailing: number;
}

/** Struct sizes + payload start from a .bp file's own schema header. */
function parseSizes(dv: DataView): { sizes: number[]; payload: number } {
  let o = 4;
  const sizes: number[] = [];
  for (let i = 0, n = dv.getInt32(0, true); i < n; i++) {
    o += 8;
    sizes.push(dv.getInt32(o, true));
    const fieldCount = dv.getInt32(o + 4, true);
    o += 8 + 16 * fieldCount;
  }
  return { sizes, payload: o };
}

export function readBp(file: string): BpRecord[] {
  const bytes = readFileSync(new URL(encodeURIComponent(file), DATA));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { sizes, payload } = parseSizes(dv);
  const out: BpRecord[] = [];
  let off = payload;
  while (off + 12 <= dv.byteLength) {
    const prefab = dv.getBigUint64(off, true);
    const size = sizes[dv.getInt32(off + 8, true)];
    const data = off + 12;
    if (size === undefined || data + size + 4 > dv.byteLength) break;
    out.push({
      prefab,
      gt: unpackGt(dv.getUint32(data + GT_DATA_OFFSET, true)),
      trailing: dv.getInt32(data + size, true),
    });
    off = data + size + 4;
  }
  return out;
}

/** Every record of one prefab, keyed by its `_gt` cell. */
export function byCell(file: string, prefab: bigint): Map<string, BpRecord> {
  const out = new Map<string, BpRecord>();
  for (const r of readBp(file)) {
    if (r.prefab === prefab) out.set(`${r.gt.x},${r.gt.y},${r.gt.z}`, r);
  }
  return out;
}
