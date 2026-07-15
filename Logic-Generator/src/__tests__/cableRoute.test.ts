import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import { layoutGraph } from "../layout/layout";
import { route3DCables, type RouteEdge } from "../layout/cableRoute";
import type { Cell } from "../layout/layout";

const yk = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

describe("game-grid cable router", () => {
  it("never places a cable on a block cell or shares a cell with another cable", () => {
    // A formula with a feedback edge forces backward routing + potential crossings.
    const laid = layoutGraph(compileFormula("u = Kp*(t - p) + Kd*deriv(t - p)"));
    // Blocks are 2×2 — no cable may sit on any footprint cell.
    const blocks = new Set<string>();
    for (const n of laid.nodes) {
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        blocks.add(yk({ x: n.cell!.x + dx, y: n.cell!.y, z: n.cell!.z + dz }));
      }
    }

    const seen = new Set<string>();
    for (const c of laid.cableCells) {
      expect(blocks.has(yk(c))).toBe(false); // no cable through a block
      expect(seen.has(yk(c))).toBe(false); // no two cables in the same cell
      seen.add(yk(c));
    }
  });

  it("bridges (rises to y+1) when a crossing is unavoidable", () => {
    // A is a long wall along z=0; B crosses it near the middle, where detouring
    // around either end costs far more than a bridge (so A* must bridge).
    const y = 24;
    const edges: RouteEdge[] = [
      { id: "A", start: { x: 0, y, z: 0 }, end: { x: 100, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 50, y, z: -1 }, end: { x: 50, y, z: 1 }, startRot: 0, endRot: 0 },
    ];
    const blocks: Cell[] = [];
    const { cells, failed } = route3DCables(edges, blocks);
    expect(failed).toEqual([]);
    expect(cells.some((c) => c.y === y + 1)).toBe(true); // a bridge span exists
    // The crossed cell (50,y,0) is owned by exactly one cable at y0.
    const atCrossY0 = cells.filter((c) => c.x === 50 && c.z === 0 && c.y === y);
    expect(atCrossY0.length).toBe(1);
  });
});
