import type { Cell } from "./layout";
import { gameQuat, rotateVec, type Vec3 } from "../serializer/rotations";

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
 * One rot per L-turn, keyed by the sorted neighbor-direction set. Flat corners
 * (both arms horizontal) plus vertical corners (one arm ±Y).
 *
 * FLAT: measured — `807f5ee1… Generated Calib All cable rotations.bp` vs the
 * hand-built `0d6fbbde… Actual All cable Rotations.bp` agree on all four (the
 * game built `+Z|-X` as 18, this table's twin of 5 — same shape, other face).
 * These four are the only entries {@link cornerRot} is ever asked for; a
 * vertical corner routes through {@link bridgeRampRot} instead. Pinned by
 * `cableRot.test.ts`.
 *
 * VERTICAL: UNVERIFIED. The same diff disagrees on six of the eight, and no
 * rigid orientation of the L reconciles them (the hand-built row contains all
 * 12 shapes, but six sit on the wrong cell — two 3-cycles). Either the viewer's
 * vertical arms are drawn wrong or an isolated cable can't be hand-built with a
 * down/Z arm. Unused by the router, so left as-is pending a cleaner fixture.
 *
 * All corners are trailing 1, which the hand-built file confirms: the game
 * wrote trailing 1 for every one of the 12 bent cables.
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

export const DIR_VEC: Record<Dir3, Vec3> = {
  "+X": [1, 0, 0], "-X": [-1, 0, 0],
  "+Y": [0, 1, 0], "-Y": [0, -1, 0],
  "+Z": [0, 0, 1], "-Z": [0, 0, -1],
};

/**
 * The cable mesh is an L, and in its LOCAL frame its two arms point +X and +Y.
 * Solved from `CORNER_ROT` (rot 0 = arms +X|+Z in world) and cross-checked: it
 * reproduces all 12 verified entries exactly. See `cableShapes.test.ts`.
 */
const LOCAL_ARMS: readonly Vec3[] = [DIR_VEC["+X"], DIR_VEC["+Y"]];

function nearestDir(v: Vec3): Dir3 {
  const axes: Dir3[][] = [["+X", "-X"], ["+Y", "-Y"], ["+Z", "-Z"]];
  const i = v.reduce((best, _, j) => (Math.abs(v[j]) > Math.abs(v[best]) ? j : best), 0);
  return axes[i][v[i] > 0 ? 0 : 1];
}

/**
 * Which two directions a cable cell's arms point for a given `_gt.rot` — the
 * inverse of {@link cornerRot}, and what a viewer needs to draw the real mesh.
 *
 * The L is symmetric under the 180° flip that swaps its arms, so the 24 rots
 * collapse 2:1 onto 12 direction sets: each L has a twin rot that differs only
 * by which face is up, which nothing observable depends on. `CORNER_ROT` picks
 * one rot per set; the twin is never generated.
 */
export function cableDirsForRot(rot: number): Dir3[] {
  const q = gameQuat(rot);
  return LOCAL_ARMS.map((v) => nearestDir(rotateVec(q, v)));
}

/**
 * Vertical corner rots for BRIDGE ramps, read from the real in-game bridge
 * `1b66fd4d… Cable Bridge.bp`. These differ from the isolated vertical corners
 * in `CORNER_ROT` (All Possible Rotations) — a ramp inside a continuous up/over/
 * down bridge is a different orientation than a standalone corner. Keys are the
 * sorted neighbor-direction set of the ramp cell.
 */
const BRIDGE_RAMP: Record<string, number> = {
  // X-travel bridge: {-X,+Y} up-foot, {+X,-Y} up-top, {-X,-Y} down-top, {+X,+Y} down-foot
  "+Y|-X": 11, "+X|-Y": 2, "-X|-Y": 14, "+X|+Y": 3,
  // Z-travel bridge: {-Z,+Y} up-foot, {+Z,-Y} up-top, {-Z,-Y} down-top, {+Z,+Y} down-foot
  "+Y|-Z": 21, "+Z|-Y": 12, "-Y|-Z": 20, "+Y|+Z": 9,
};

/** `_gt.rot` for a bridge ramp (foot/top) cell by its neighbor-direction set. */
export function bridgeRampRot(dirs: Iterable<Dir3>): number {
  return BRIDGE_RAMP[[...new Set(dirs)].sort().join("|")] ?? 0;
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

