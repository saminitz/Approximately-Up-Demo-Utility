// .bp payload writer.
//
// Record grammar (GT_REPORT_v2.md), tightly packed from header end to EOF:
//   prefab(8) | idx(4) | entityId(20) | _gt(4) | <component fields> | trailing(4)
//
// The bundled schema header still documents a 16-byte `_guid` with `_gt` at +0x10;
// the game actually stores a 20-byte entity id and reads `_gt` at data+0x14.
//
// The header is reused verbatim from a real reference blueprint (byte-exact for
// this game version), so only the payload records are synthesized here.

import type { BlockNode } from "../compiler/graph";
import { OPS } from "../formula/catalog";
import type { LaidOutGraph } from "../layout/layout";
import { BinaryWriter } from "./binaryWriter";
import { packGt } from "./gtCodec";
import { getReferenceHeader, findFieldOffset, type HeaderStruct } from "./header";
import { ROT_LOGIC } from "./rotations";
import {
  CABLE_PREFAB,
  FIELD_HASH,
  PREFAB_TABLE,
  WIRELESS_DEFAULT_CHANNEL,
} from "./prefabTable";

/** Bytes reserved for the per-entity id prefix (Hash128 + 4-byte tail). */
export const ENTITY_ID_BYTES = 20;

/** On-disk `_gt` offset inside BlueprintData (after the 20-byte entity id). */
export const GT_DATA_OFFSET = 0x14;

/** Schema header still places `_gt` immediately after a 16-byte guid. */
const HEADER_GT_OFFSET = 16;

export interface BpWriteOptions {
  /** Emit one cable-cell record per routed grid cell (provisional). */
  emitCables: boolean;
  /** Default rotation index for placed blocks. */
  rot: number;
}

export const DEFAULT_BP_OPTIONS: BpWriteOptions = {
  emitCables: true,
  rot: ROT_LOGIC,
};

export interface BpBuildResult {
  bytes: Uint8Array;
  blockRecords: number;
  cableRecords: number;
}

export type EntityId = [number, number, number, number, number];

// Simple deterministic PRNG so repeated exports of the same graph are stable.
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}

/** Map schema field offsets (16-byte guid) to the real 20-byte entity layout. */
export function adjustedFieldOffset(
  struct: HeaderStruct,
  nameHash: bigint,
): number | null {
  if (nameHash === FIELD_HASH.guid) return null;
  if (nameHash === FIELD_HASH.gt) return GT_DATA_OFFSET;
  const off = findFieldOffset(struct, nameHash);
  if (off === null) return null;
  if (off >= HEADER_GT_OFFSET) return off + (GT_DATA_OFFSET - HEADER_GT_OFFSET);
  return off;
}

function writeEntityId(dv: DataView, entityId: EntityId): void {
  for (let i = 0; i < 5; i++) {
    dv.setUint32(i * 4, entityId[i] >>> 0, true);
  }
}

function writeU32(dv: DataView, off: number, structSize: number, value: number): void {
  if (off < 0 || off + 4 > structSize) return;
  dv.setUint32(off, value >>> 0, true);
}

function writeF32(dv: DataView, off: number, structSize: number, value: number): void {
  if (off < 0 || off + 4 > structSize) return;
  dv.setFloat32(off, value, true);
}

function writeU8(dv: DataView, off: number, structSize: number, value: number): void {
  if (off < 0 || off + 1 > structSize) return;
  dv.setUint8(off, value & 0xff);
}

/**
 * Knob values a block carries in its own fields: a Constant's `_value`, plus the
 * literals the formula set on the block (Simple Threshold, Remapper).
 */
function blockValues(node: BlockNode): Record<string, number> {
  const values: Record<string, number> = {};
  if (node.value !== undefined) values.value = node.value;
  OPS[node.op].params?.forEach((name, i) => {
    const v = node.params?.[i];
    if (v !== undefined) values[name] = v;
  });
  return values;
}

/** Write a single fixed-layout payload record into `w`. */
function writeRecord(
  w: BinaryWriter,
  struct: HeaderStruct,
  prefab: bigint,
  fields: {
    entityId: EntityId;
    gt: number;
    /** Block knobs by FIELD_HASH name; ones the struct lacks are dropped. */
    values?: Record<string, number>;
    col?: number;
    channel?: number;
  },
  trailing = 0,
): void {
  const data = new Uint8Array(struct.sizeof);
  const dv = new DataView(data.buffer);

  writeEntityId(dv, fields.entityId);
  writeU32(dv, GT_DATA_OFFSET, struct.sizeof, fields.gt);

  for (const [name, v] of Object.entries(fields.values ?? {})) {
    const hash = FIELD_HASH[name as keyof typeof FIELD_HASH];
    const off = hash === undefined ? null : adjustedFieldOffset(struct, hash);
    if (off !== null) writeF32(dv, off, struct.sizeof, v);
  }
  if (fields.channel !== undefined) {
    const chOff = adjustedFieldOffset(struct, FIELD_HASH.channel);
    if (chOff !== null) writeU32(dv, chOff, struct.sizeof, fields.channel);
  }
  const colOff = adjustedFieldOffset(struct, FIELD_HASH.col);
  if (colOff !== null) writeU8(dv, colOff, struct.sizeof, fields.col ?? 0);

  w.u64(prefab);
  w.i32(struct.index);
  w.bytes(data);
  w.i32(trailing);
}

export function buildBp(
  laid: LaidOutGraph,
  opts: BpWriteOptions = DEFAULT_BP_OPTIONS,
): BpBuildResult {
  const header = getReferenceHeader();
  const w = new BinaryWriter(header.byteLength + 4096);
  w.bytes(header.bytes); // verbatim schema header

  const rng = makeRng(0x51ceb00c);
  const entityId = (): EntityId => [
    0, // first dword is 0 for all reference entities
    rng(),
    rng(),
    rng(),
    rng(),
  ];

  let blockRecords = 0;
  for (const node of laid.nodes) {
    const cell = node.cell ?? { x: 0, y: 0, z: 0 };
    const entry = PREFAB_TABLE[node.op];
    const struct = header.structs[entry.structIndex];
    // Sink terminals reuse the source (wireless) prefab and take the same base
    // rot as every other block: port-map.json measures that prefab's port at
    // +X/dx 2 with anchor rot 3, and `PORT_BY_OP.output` cables into that same
    // +X cell — an extra 180° flip only rotated the mesh away from its cable.
    const rot = node.rot ?? opts.rot;
    const gt = packGt({ x: cell.x, y: cell.y, z: cell.z, rot });
    const isWireless = entry.structIndex === PREFAB_TABLE.input.structIndex;
    writeRecord(w, struct, entry.hash, {
      entityId: entityId(),
      gt,
      values: blockValues(node),
      channel: isWireless ? WIRELESS_DEFAULT_CHANNEL : undefined,
      col: 0,
    });
    blockRecords++;
  }

  let cableRecords = 0;
  if (opts.emitCables) {
    const cableStruct = header.structs[CABLE_PREFAB.structIndex];
    for (const cell of laid.cableCells) {
      const gt = packGt({ x: cell.x, y: cell.y, z: cell.z, rot: cell.rot });
      writeRecord(
        w,
        cableStruct,
        CABLE_PREFAB.hash,
        {
          entityId: entityId(),
          gt,
          col: 0,
        },
        cell.trailing,
      );
      cableRecords++;
    }
  }

  return { bytes: w.toUint8Array(), blockRecords, cableRecords };
}
