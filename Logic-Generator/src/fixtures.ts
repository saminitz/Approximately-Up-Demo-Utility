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
import type { LaidOutGraph } from "./layout/layout";
import { INTERIOR_BASE_CELL } from "./layout/layout";
import { footprintForOp } from "./catalog/ports";
import { OPS, type OpKey } from "./formula/catalog";
import type { CableCell } from "./layout/cableShapes";
import { PREFAB_TABLE } from "./serializer/prefabTable";
import { ROTATIONS } from "./serializer/rotations";

const BASE = INTERIOR_BASE_CELL;

/** Spacing along the index axis: 2-wide block + a gap wide enough to see. */
const STEP_X = 4;
/** Row spacing: clears a 4-tall block plus a channel. */
const STEP_Z = 6;

function emptyLaid(nodes: BlockNode[], cableCells: CableCell[]): LaidOutGraph {
  const cells = [...nodes.map((n) => n.cell!), ...cableCells];
  return {
    nodes,
    edges: [],
    routes: [],
    cableCells,
    cableChains: [],
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
 * A lone cable cell in all 24 `_gt.rot` values, rot ascending along +X, with
 * both trailing values (row z = anchor: trailing 0; row z + STEP_Z: trailing 1).
 * The captured in-game mesh per (rot, trailing) is what replaces the guessed
 * entries in `layout/cableShapes.ts`.
 */
export function fixtureAllCableRots(): LaidOutGraph {
  const cells: CableCell[] = [];
  for (const trailing of [0, 1]) {
    for (let rot = 0; rot < ROTATIONS.length; rot++) {
      cells.push({
        x: BASE.x + rot * 3,
        y: BASE.y,
        z: BASE.z + trailing * STEP_Z,
        rot,
        trailing,
      });
    }
  }
  return emptyLaid(markers(cells), cells);
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
];
