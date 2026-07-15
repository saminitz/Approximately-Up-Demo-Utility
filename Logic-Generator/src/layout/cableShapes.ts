import type { Cell } from "./layout";

/** Cardinal directions on the controller circuit plane (constant Y). */
export type PlaneDir = "+X" | "-X" | "+Z" | "-Z";

export interface CableCell extends Cell {
  /** Cable mesh orientation — encoded in `_gt` bits 27..31 (not a separate `_shape` byte). */
  rot: number;
  trailing: number;
}

const DEFAULT_CABLE_TYPE = 48; // SpaceshipCableType — dominant in PD reference blueprint

/** Unit step between two orthogonally adjacent cells on the X-Z plane. */
export function dirBetween(a: Cell, b: Cell): PlaneDir | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx === 1 && dz === 0) return "+X";
  if (dx === -1 && dz === 0) return "-X";
  if (dx === 0 && dz === 1) return "+Z";
  if (dx === 0 && dz === -1) return "-Z";
  return null;
}

export interface CableMeta {
  rot: number;
  trailing: number;
  type: number;
}

/**
 * Empirical cable orientation table from `989e5da9… PD Target Distance.bp`
 * (146 primary cable cells, `_gt` @ data+0x14, connectivity from decoded X-Z grid).
 *
 * Cables use the same `_gt` pack as blocks but orientation lives in the 5-bit `rot`
 * field — there is no room for `_shape` once the 20-byte entity id is accounted for
 * (sizeof=24 = entity 20 + `_gt` 4 only).
 *
 * | topology        | dirs (sorted)   | rot (dominant) | trailing |
 * |-----------------|-----------------|----------------|----------|
 * | straight +X     | +X\|-X          | 0              | 0        |
 * | straight +Z     | +Z\|-Z          | 16             | 0        |
 * | corner          | +X\|-Z          | 5              | 0        |
 * | corner          | -X\|-Z          | 4              | 1        |
 * | corner          | +Z\|-X          | 5              | 1        |
 * | corner          | +X\|+Z          | 6              | 1        |
 * | tee             | +X\|+Z\|-X      | 0              | 0        |
 * | tee             | +X\|-X\|-Z      | 0              | 0        |
 * | tee             | +X\|+Z\|-Z      | 16             | 0        |
 * | cross           | +X\|+Z\|-X\|-Z  | 21             | 0        |
 * | endpoint cap    | +X              | 15             | 1        |
 * | endpoint cap    | +Z              | 17             | 1        |
 * | endpoint cap    | -X              | 14             | 1        |
 * | endpoint cap    | -Z              | 21             | 1        |
 * | block port stub | (none)          | 12             | 0        |
 */
const STRAIGHT_X: CableMeta = { rot: 0, trailing: 0, type: DEFAULT_CABLE_TYPE };
const STRAIGHT_Z: CableMeta = { rot: 16, trailing: 0, type: DEFAULT_CABLE_TYPE };
const BLOCK_STUB: CableMeta = { rot: 12, trailing: 0, type: DEFAULT_CABLE_TYPE };

/** Cardinal directions including the vertical axis (used by bridge corners). */
export type Dir3 = PlaneDir | "+Y" | "-Y";

/**
 * Every corner orientation, verified from `19192c81… Cable All Possible
 * Rotations.bp`: one rot per L-turn keyed by the sorted neighbor-direction set.
 * Flat corners (both arms horizontal) plus vertical corners (one arm ±Y, the
 * horizontal↔up/down transitions inside a bridge). All corners have trailing 1.
 */
export const CORNER_ROT: Record<string, number> = {
  // flat
  "+X|+Z": 0, "+X|-Z": 22, "+Z|-X": 5, "-X|-Z": 23,
  // up: horizontal arm + +Y
  "+X|+Y": 10, "+Y|+Z": 9, "+Y|-X": 11, "+Y|-Z": 8,
  // down: horizontal arm + -Y
  "+X|-Y": 15, "+Z|-Y": 17, "-X|-Y": 7, "-Y|-Z": 20,
};

/** `_gt.rot` for a corner cell given its two neighbor directions (any axis). */
export function cornerRot(dirs: Iterable<Dir3>): number {
  return CORNER_ROT[[...new Set(dirs)].sort().join("|")] ?? 5;
}

/** Elevated straight (bridge span at y+1): X keeps 0, Z is 21 (not ground 16). */
export const SPAN_ROT = { X: 0, Z: 21 } as const;

const CORNER: Record<string, CableMeta> = {
  "+X|+Z": { rot: CORNER_ROT["+X|+Z"], trailing: 1, type: DEFAULT_CABLE_TYPE },
  "+X|-Z": { rot: CORNER_ROT["+X|-Z"], trailing: 1, type: DEFAULT_CABLE_TYPE },
  "+Z|-X": { rot: CORNER_ROT["+Z|-X"], trailing: 1, type: DEFAULT_CABLE_TYPE },
  "-X|-Z": { rot: CORNER_ROT["-X|-Z"], trailing: 1, type: DEFAULT_CABLE_TYPE },
};

const TEE: Record<string, CableMeta> = {
  "+X|+Z|-X": { rot: 0, trailing: 0, type: DEFAULT_CABLE_TYPE },
  "+X|-X|-Z": { rot: 0, trailing: 0, type: DEFAULT_CABLE_TYPE },
  "+X|+Z|-Z": { rot: 16, trailing: 0, type: DEFAULT_CABLE_TYPE },
  "+X|+Z|-X|-Z": { rot: 21, trailing: 0, type: DEFAULT_CABLE_TYPE },
  "+Z|-X|-Z": { rot: 21, trailing: 0, type: DEFAULT_CABLE_TYPE },
};

const ENDPOINT: Record<PlaneDir, CableMeta> = {
  "+X": { rot: 15, trailing: 1, type: DEFAULT_CABLE_TYPE },
  "+Z": { rot: 17, trailing: 1, type: DEFAULT_CABLE_TYPE },
  "-X": { rot: 14, trailing: 1, type: DEFAULT_CABLE_TYPE },
  "-Z": { rot: 21, trailing: 1, type: DEFAULT_CABLE_TYPE },
};

function dirKey(dirs: Iterable<PlaneDir>): string {
  return [...new Set(dirs)].sort().join("|");
}

function axisOf(d: PlaneDir): "X" | "Z" {
  return d.includes("X") ? "X" : "Z";
}

/**
 * Map grid connectivity to per-cell cable `_gt.rot` and record trailing int32.
 * Uses the sorted neighbor-direction set; corner/tee keys match the PD reference.
 */
export function cableMetaFromDirs(dirs: Iterable<PlaneDir>): CableMeta {
  const unique = [...new Set(dirs)];
  const n = unique.length;
  if (n === 0) return BLOCK_STUB;
  if (n === 1) return ENDPOINT[unique[0]];

  const key = dirKey(unique);
  if (n === 2) {
    const axes = new Set(unique.map(axisOf));
    if (axes.size === 1) return axes.has("X") ? STRAIGHT_X : STRAIGHT_Z;
    return CORNER[key] ?? { rot: 5, trailing: 1, type: DEFAULT_CABLE_TYPE };
  }

  return TEE[key] ?? { rot: 0, trailing: 0, type: DEFAULT_CABLE_TYPE };
}

/** @deprecated alias kept for tests migrating from the old `_shape` byte guess. */
export function cableShapeFromDirs(dirs: Iterable<PlaneDir>): {
  shape: number;
  trailing: number;
  type: number;
} {
  const m = cableMetaFromDirs(dirs);
  return { shape: m.rot, trailing: m.trailing, type: m.type };
}

