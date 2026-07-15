// Calibration fixtures: synthetic blueprints built to be imported in-game,
// compared against a hand-built reference, and diffed back into the mapping
// tables (PREFAB_TABLE, ROTATIONS, cableShapes.ts).
//
// These bypass the formula/compiler/router entirely — they place blocks and
// cable cells directly — but export through the same buildBp/exportZip path,
// so what they prove holds for real exports.
//
// There is no text block in-game, so index is encoded by POSITION: every
// fixture lays its items out along +X in ascending index, evenly spaced from
// the anchor. The i-th item from the anchor corner is index i.

import type { BlockNode } from "./compiler/graph";
import type { Cell, LaidOutGraph } from "./layout/layout";
import { INTERIOR_BASE_CELL } from "./layout/layout";
import { footprintForOp } from "./catalog/ports";
import { OPS, type OpKey } from "./formula/catalog";
import {
  CORNER_ROT,
  DIR_VEC,
  cableMetaFromDirs,
  cornerRot,
  type CableCell,
  type Dir3,
  type PlaneDir,
} from "./layout/cableShapes";
import { PREFAB_TABLE } from "./serializer/prefabTable";
import { ROTATIONS } from "./serializer/rotations";

const BASE = INTERIOR_BASE_CELL;

/** Spacing along the index axis: 2-wide block + a gap wide enough to see. */
const STEP_X = 4;

function emptyLaid(
  nodes: BlockNode[],
  cableCells: CableCell[],
  cableChains: LaidOutGraph["cableChains"] = [],
): LaidOutGraph {
  const cells = [...nodes.map((n) => n.cell!), ...cableCells];
  return {
    nodes,
    edges: [],
    routes: [],
    cableCells,
    cableChains,
    inputs: [],
    outputs: [],
    bounds: {
      cols: nodes.length,
      rows: 1,
      maxX: Math.max(BASE.x, ...cells.map((c) => c.x)),
      maxZ: Math.max(BASE.z, ...cells.map((c) => c.z)),
    },
  };
}

function block(id: string, op: OpKey, cell: BlockNode["cell"], rot?: number): BlockNode {
  return {
    id,
    op,
    label: rot === undefined ? OPS[op].label : `${OPS[op].label} rot ${rot}`,
    inputs: OPS[op].inputs,
    outputs: OPS[op].outputs,
    cell,
    rot,
    value: op === "constant" ? 1 : undefined,
  };
}

/** Constant blocks reading 0 and 100 that bracket the row, so the index axis is
 * unambiguous in-game: items run 0-end → 100-end, one step apart. */
export const MARKER_PREFIX = "fx-marker-";

function markers(items: { x: number }[]): BlockNode[] {
  const xs = items.map((i) => i.x);
  const lo = Math.min(BASE.x, ...xs) - STEP_X;
  const hi = Math.max(BASE.x, ...xs) + STEP_X;
  const at = (id: string, x: number, value: number, label: string): BlockNode => ({
    ...block(`${MARKER_PREFIX}${id}`, "constant", { x, y: BASE.y, z: BASE.z }),
    value,
    label,
  });
  return [at("start", lo, 0, "START (0)"), at("end", hi, 100, "END (100)")];
}

/**
 * One block of every op whose prefab hash is pinned, in a single +X row.
 * Ops with placeholder hashes are skipped — they would import as an adder and
 * only pollute the diff. Order is OPS declaration order.
 */
export function fixtureAllBlocks(): LaidOutGraph {
  const ops = (Object.keys(OPS) as OpKey[]).filter((op) => PREFAB_TABLE[op].known);
  const nodes = ops.map((op, i) =>
    block(`fx-${op}`, op, { x: BASE.x + i * STEP_X, y: BASE.y, z: BASE.z }),
  );
  return emptyLaid([...nodes, ...markers(nodes.map((n) => n.cell!))], []);
}

/**
 * One op (adder — smallest pinned block, 2×2) in all 24 `_gt.rot` values, rot
 * ascending along +X. Reveals which ROTATIONS index actually yields which
 * in-game orientation, so the ROT_LOGIC guess can be replaced by a read value.
 */
export function fixtureAllRotations(op: OpKey = "add"): LaidOutGraph {
  const { w } = footprintForOp(op);
  const step = Math.max(STEP_X, w + 2);
  const nodes = ROTATIONS.map((_, rot) =>
    block(`fx-rot-${rot}`, op, { x: BASE.x + rot * step, y: BASE.y, z: BASE.z }, rot),
  );
  return emptyLaid([...nodes, ...markers(nodes.map((n) => n.cell!))], []);
}

/**
 * One lone cable cell per DISTINCT L orientation — the 12 `CORNER_ROT` rots, in
 * ascending rot along +X. The cable mesh is an L symmetric under the flip that
 * swaps its arms, so the 24 rots are 12 pairs that differ only by which face is
 * up; only one of each pair is emitted, since a hand-built reference can't
 * reproduce the twin and nothing depends on it. All corners are trailing 1.
 */
export function fixtureAllCableRots(): LaidOutGraph {
  const cells: CableCell[] = [...new Set(Object.values(CORNER_ROT))]
    .sort((a, b) => a - b)
    .map((rot, i) => ({ x: BASE.x + i * 3, y: BASE.y, z: BASE.z, rot, trailing: 1 }));
  return emptyLaid(markers(cells), cells);
}

const DIRS: Dir3[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
const opposite = (d: Dir3) => ((d[0] === "+" ? "-" : "+") + d[1]) as Dir3;
const key = (c: Cell) => `${c.x},${c.y},${c.z}`;
const step = (c: Cell, d: Dir3): Cell => {
  const v = DIR_VEC[d];
  return { x: c.x + v[0], y: c.y + v[1], z: c.z + v[2] };
};
/** Arm set of the cell reached by `into`, then left by `out`. */
const armKey = (into: Dir3, out: Dir3) => [opposite(into), out].sort().join("|");

/** All 12 L shapes = every unordered pair of non-opposite directions. */
const ALL_LS = new Set(
  DIRS.flatMap((a) => DIRS.filter((b) => b !== a && b !== opposite(a)).map((b) => armKey(opposite(a), b))),
);

/**
 * Self-avoiding walk whose turn cells cover all 12 L shapes exactly.
 *
 * Constraints that keep the strand readable and writable in-game:
 *  - no two non-consecutive cells touch, so the strand never reads as a tee/cross;
 *  - no vertical straight (a ±Y run of 2+), since only X/Z straights have a
 *    measured rot — every vertical move is a single cell between two corners;
 *  - both ends run horizontally, since only planar endpoint caps are measured.
 */
function snakeMoves(maxLen = 40): Dir3[] {
  const start: Cell = { x: 0, y: 0, z: 0 };
  const inBox = (c: Cell) => c.x >= 0 && c.x <= 7 && c.y >= 0 && c.y <= 4 && c.z >= 0 && c.z <= 7;
  const path = [start];
  const used = new Set([key(start)]);
  const moves: Dir3[] = [];
  const covered = new Map<string, number>();

  const fits = (c: Cell) =>
    inBox(c) &&
    !used.has(key(c)) &&
    // touching any earlier cell but the one we came from would fuse the strand
    DIRS.filter((d) => used.has(key(step(c, d)))).length === 1;

  const dfs = (): boolean => {
    const prev = moves.at(-1);
    if (covered.size === ALL_LS.size && prev && !prev.includes("Y")) return true;
    if (moves.length >= maxLen) return false;
    const here = path.at(-1)!;
    // Prefer moves that reveal a shape we don't have yet.
    const options = DIRS.filter((d) => fits(step(here, d))).sort(
      (a, b) =>
        Number(prev !== undefined && covered.has(armKey(prev, a))) -
        Number(prev !== undefined && covered.has(armKey(prev, b))),
    );
    for (const d of options) {
      if (prev === d && d.includes("Y")) continue; // vertical straight: no known rot
      // A straight's arm set is an opposite pair, not an L — never counts.
      const key0 = prev === undefined ? null : armKey(prev, d);
      const arm = key0 !== null && ALL_LS.has(key0) ? key0 : null;
      if (arm !== null) covered.set(arm, (covered.get(arm) ?? 0) + 1);
      const next = step(here, d);
      path.push(next);
      used.add(key(next));
      moves.push(d);
      if (dfs()) return true;
      moves.pop();
      used.delete(key(next));
      path.pop();
      if (arm !== null) {
        const n = covered.get(arm)! - 1;
        if (n === 0) covered.delete(arm);
        else covered.set(arm, n);
      }
    }
    return false;
  };

  // The first move must be horizontal too — cell 0 is an endpoint cap.
  for (const d of DIRS.filter((x) => !x.includes("Y"))) {
    const next = step(start, d);
    if (!fits(next)) continue;
    path.push(next);
    used.add(key(next));
    moves.push(d);
    if (dfs()) return moves;
    moves.pop();
    used.delete(key(next));
    path.pop();
  }
  throw new Error("no cable snake covering all 12 L shapes");
}

/**
 * ONE continuous cable strand that passes through all 12 distinct L
 * orientations, plus straights and two endpoint caps — the successor to
 * {@link fixtureAllCableRots}, whose 12 isolated corners could not be rebuilt
 * by hand once an arm pointed up or down (see `cableRot.test.ts`). A real
 * strand can: the game will only let you draw shapes it actually has, so
 * whatever the user fixes in-game is readable straight back into `CORNER_ROT`.
 */
export function fixtureCableSnake(): LaidOutGraph {
  const moves = snakeMoves();
  const cells: CableCell[] = [];
  let at: Cell = { x: BASE.x, y: BASE.y, z: BASE.z };
  for (let i = 0; i <= moves.length; i++) {
    const dirs: Dir3[] = [];
    if (i > 0) dirs.push(opposite(moves[i - 1]));
    if (i < moves.length) dirs.push(moves[i]);
    const vertical = dirs.some((d) => d.includes("Y"));
    const meta = vertical
      ? { rot: cornerRot(dirs), trailing: 1 }
      : cableMetaFromDirs(dirs as PlaneDir[]);
    cells.push({ ...at, rot: meta.rot, trailing: meta.trailing });
    if (i < moves.length) at = step(at, moves[i]);
  }
  // Hand the viewer the real connectivity. Without a chain it falls back to
  // reading arms out of `_gt.rot`, which draws every cell as an L — including
  // the straights, whose rot 0 collides with the "+X|+Z" corner's rot 0.
  return emptyLaid(markers(cells), cells, [{ edgeId: "fx-snake", cells }]);
}

/**
 * Axis probe, anchored at grid (0,0,0) instead of the usual interior anchor: one
 * constant block at the origin and one 4 cells out along each axis, the block's
 * `_value` naming the axis. Read the values in-game to learn how the generator's
 * X/Y/Z map to what you see, which is what fixes the block flip (see Circuit3D's
 * rotQuat ponytail note).
 *
 *   value 0 = origin · 1 = +X · 2 = +Y (up) · 3 = +Z
 */
export function fixtureAxisMarkers(): LaidOutGraph {
  const at = (id: string, x: number, y: number, z: number, value: number, label: string) => ({
    ...block(`fx-axis-${id}`, "constant", { x, y, z }),
    value,
    label,
  });
  return emptyLaid(
    [
      at("origin", 0, 0, 0, 0, "0 = origin"),
      at("x", 4, 0, 0, 1, "1 = +X"),
      at("y", 0, 4, 0, 2, "2 = +Y (up)"),
      at("z", 0, 0, 4, 3, "3 = +Z"),
    ],
    [],
  );
}

export const FIXTURES: { name: string; build: () => LaidOutGraph }[] = [
  { name: "Axis markers", build: fixtureAxisMarkers },
  { name: "All blocks", build: fixtureAllBlocks },
  { name: "All block rotations", build: fixtureAllRotations },
  { name: "All cable rotations", build: fixtureAllCableRots },
  { name: "Cable snake (all rotations, continuous)", build: fixtureCableSnake },
];
