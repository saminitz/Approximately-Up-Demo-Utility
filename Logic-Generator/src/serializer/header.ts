// Parse the bundled reference .bp schema header into a usable struct table.
//
// Header grammar (little-endian, scratch/REPORT.md §2):
//   int32  structCount
//   repeat structCount:
//     uint64 structNameHash
//     int32  sizeof
//     int32  fieldCount
//     repeat fieldCount:
//       uint64 fieldNameHash
//       int32  fieldOffset
//       int32  fieldSizeof

import {
  REFERENCE_HEADER_BASE64,
  REFERENCE_HEADER_BYTE_LENGTH,
} from "./referenceHeader";

export interface HeaderField {
  nameHash: bigint;
  offset: number;
  sizeof: number;
}

export interface HeaderStruct {
  index: number;
  nameHash: bigint;
  sizeof: number;
  fields: HeaderField[];
}

export interface ParsedHeader {
  bytes: Uint8Array;
  structCount: number;
  structs: HeaderStruct[];
  /** Byte length of the header block (= start of the payload). */
  byteLength: number;
}

function base64ToBytes(b64: string): Uint8Array {
  // `atob` is available in the browser and in Node >= 18 (used by vitest).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cached: ParsedHeader | null = null;

export function getReferenceHeader(): ParsedHeader {
  if (cached) return cached;

  const bytes = base64ToBytes(REFERENCE_HEADER_BASE64);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let o = 0;
  const structCount = dv.getInt32(o, true);
  o += 4;

  const structs: HeaderStruct[] = [];
  for (let i = 0; i < structCount; i++) {
    const nameHash = dv.getBigUint64(o, true);
    o += 8;
    const sizeof = dv.getInt32(o, true);
    o += 4;
    const fieldCount = dv.getInt32(o, true);
    o += 4;
    const fields: HeaderField[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const fh = dv.getBigUint64(o, true);
      o += 8;
      const foff = dv.getInt32(o, true);
      o += 4;
      const fsz = dv.getInt32(o, true);
      o += 4;
      fields.push({ nameHash: fh, offset: foff, sizeof: fsz });
    }
    structs.push({ index: i, nameHash, sizeof, fields });
  }

  cached = { bytes, structCount, structs, byteLength: o };
  if (o !== REFERENCE_HEADER_BYTE_LENGTH) {
    // Defensive: the bundled length metadata should always agree with the parse.
    throw new Error(
      `Reference header parse mismatch: parsed ${o} bytes, expected ${REFERENCE_HEADER_BYTE_LENGTH}`,
    );
  }
  return cached;
}

/** Find the byte offset of a field (by its name hash) inside a struct, or null. */
export function findFieldOffset(
  struct: HeaderStruct,
  nameHash: bigint,
): number | null {
  const f = struct.fields.find((x) => x.nameHash === nameHash);
  return f ? f.offset : null;
}
