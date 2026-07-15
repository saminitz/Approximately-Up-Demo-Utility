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

const CORNER: Record<string, CableMeta> = {
  "+X|-Z": { rot: 5, trailing: 0, type: DEFAULT_CABLE_TYPE },
  "-X|-Z": { rot: 4, trailing: 1, type: DEFAULT_CABLE_TYPE },
  "+Z|-X": { rot: 5, trailing: 1, type: DEFAULT_CABLE_TYPE },
  "+X|+Z": { rot: 6, trailing: 1, type: DEFAULT_CABLE_TYPE },
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

function cellKey(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

/**
 * Collect routed path cells and assign per-cell cable metadata from path
 * connectivity. Cells shared by multiple routes merge their direction sets.
 */
export function buildCableCells(
  routes: { cells: Cell[] }[],
  blocked: Set<string>,
  /** cellKey -> forced `_gt.rot` for the first cable cell at a block port. */
  forcedRot: Map<string, number> = new Map(),
): CableCell[] {
  const dirSets = new Map<string, Set<PlaneDir>>();

  const addDir = (from: Cell, to: Cell) => {
    const d = dirBetween(from, to);
    if (!d) return;
    const rev: PlaneDir =
      d === "+X" ? "-X" : d === "-X" ? "+X" : d === "+Z" ? "-Z" : "+Z";
    const kFrom = cellKey(from);
    const kTo = cellKey(to);
    if (!blocked.has(kFrom)) (dirSets.get(kFrom) ?? dirSets.set(kFrom, new Set()).get(kFrom)!).add(d);
    if (!blocked.has(kTo)) (dirSets.get(kTo) ?? dirSets.set(kTo, new Set()).get(kTo)!).add(rev);
  };

  for (const route of routes) {
    const cells = route.cells;
    for (let i = 0; i < cells.length - 1; i++) addDir(cells[i], cells[i + 1]);
  }

  const out: CableCell[] = [];
  for (const [key, dirs] of dirSets) {
    if (blocked.has(key)) continue;
    const [x, y, z] = key.split(",").map(Number);
    const meta = cableMetaFromDirs(dirs);
    const forced = forcedRot.get(key);
    out.push({ x, y, z, rot: forced ?? meta.rot, trailing: meta.trailing });
  }
  return out;
}
