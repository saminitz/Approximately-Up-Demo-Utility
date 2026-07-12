import type { Cell } from "./layout";

/** Cardinal directions on the controller circuit plane (constant Y). */
export type PlaneDir = "+X" | "-X" | "+Z" | "-Z";

export interface CableCell extends Cell {
  shape: number;
  type: number;
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

/**
 * Map connectivity on the circuit plane to `_shape` / trailing int32.
 *
 * Empirical PD blueprint (correct offsets at data+0x18):
 *   straight X or Z run (2 neighbors, same axis) -> shape 0, trailing 0
 *   corner / endpoint (turn or single neighbor)   -> shape 1, trailing 1
 *   tee / cross (3–4 neighbors)                   -> shape 0, trailing 0
 */
export function cableShapeFromDirs(dirs: Iterable<PlaneDir>): {
  shape: number;
  trailing: number;
  type: number;
} {
  const unique = new Set(dirs);
  const n = unique.size;
  if (n <= 1) return { shape: 1, trailing: 1, type: DEFAULT_CABLE_TYPE };
  if (n >= 3) return { shape: 0, trailing: 0, type: DEFAULT_CABLE_TYPE };
  const axes = new Set([...unique].map((d) => (d.includes("X") ? "X" : "Z")));
  if (axes.size === 1) return { shape: 0, trailing: 0, type: DEFAULT_CABLE_TYPE };
  return { shape: 1, trailing: 1, type: DEFAULT_CABLE_TYPE };
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
    const meta = cableShapeFromDirs(dirs);
    out.push({ x, y, z, ...meta });
  }
  return out;
}
