import { describe, expect, it } from "vitest";
import {
  FIXTURES,
  MARKER_PREFIX,
  fixtureAllBlocks,
  fixtureAllCableRots,
  fixtureAllRotations,
  fixtureAxisMarkers,
} from "../fixtures";
import { buildBp, DEFAULT_BP_OPTIONS } from "../serializer/bpWriter";
import { PREFAB_TABLE } from "../serializer/prefabTable";
import { packGt } from "../serializer/gtCodec";
import type { BlockNode } from "../compiler/graph";
import { ROTATIONS } from "../serializer/rotations";

const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;
const items = (laid: { nodes: BlockNode[] }) =>
  laid.nodes.filter((n) => !n.id.startsWith(MARKER_PREFIX));
const marks = (laid: { nodes: BlockNode[] }) =>
  laid.nodes.filter((n) => n.id.startsWith(MARKER_PREFIX));

describe("calibration fixtures", () => {
  it("all-blocks fixture only places pinned prefabs, one per op", () => {
    const laid = fixtureAllBlocks();
    expect(laid.nodes.every((n) => PREFAB_TABLE[n.op].known)).toBe(true);
    expect(new Set(items(laid).map((n) => n.op)).size).toBe(items(laid).length);
  });

  it("rotation fixture covers every rot exactly once, no shared cells", () => {
    const laid = fixtureAllRotations();
    expect(items(laid).map((n) => n.rot)).toEqual(ROTATIONS.map((_, i) => i));
    expect(new Set(laid.nodes.map((n) => key(n.cell!))).size).toBe(laid.nodes.length);
  });

  it("every row fixture is bracketed by 0/100 constant markers outside its items", () => {
    for (const build of [fixtureAllBlocks, fixtureAllRotations, fixtureAllCableRots]) {
      const laid = build();
      const m = marks(laid);
      expect(m.map((n) => n.value)).toEqual([0, 100]);
      expect(m.every((n) => n.op === "constant")).toBe(true);
      const xs = [...items(laid).map((n) => n.cell!.x), ...laid.cableCells.map((c) => c.x)];
      expect(m[0].cell!.x).toBeLessThan(Math.min(...xs));
      expect(m[1].cell!.x).toBeGreaterThan(Math.max(...xs) + 1); // clears the 2-wide body
    }
  });

  it("axis probe sits at the origin, one arm per axis, value naming the axis", () => {
    const byValue = new Map(fixtureAxisMarkers().nodes.map((n) => [n.value, n.cell!]));
    expect(byValue.get(0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(byValue.get(1)).toEqual({ x: 4, y: 0, z: 0 });
    expect(byValue.get(2)).toEqual({ x: 0, y: 4, z: 0 });
    expect(byValue.get(3)).toEqual({ x: 0, y: 0, z: 4 });
  });

  it("cable fixture covers every rot at both trailing values", () => {
    const cells = fixtureAllCableRots().cableCells;
    expect(cells.length).toBe(ROTATIONS.length * 2);
    expect(new Set(cells.map(key)).size).toBe(cells.length);
    expect(new Set(cells.filter((c) => c.trailing === 1).map((c) => c.rot)).size).toBe(
      ROTATIONS.length,
    );
  });

  it("every fixture exports, and per-node rot reaches the written _gt", () => {
    for (const f of FIXTURES) {
      const laid = f.build();
      const build = buildBp(laid, DEFAULT_BP_OPTIONS);
      expect(build.blockRecords).toBe(laid.nodes.length);
      expect(build.cableRecords).toBe(laid.cableCells.length);
    }

    const laid = fixtureAllRotations();
    const dv = new DataView(buildBp(laid, DEFAULT_BP_OPTIONS).bytes.buffer);
    const written = new Set<number>();
    for (let off = 0; off + 4 <= dv.byteLength; off++) written.add(dv.getUint32(off, true));
    for (const n of items(laid)) {
      expect(written.has(packGt({ ...n.cell!, rot: n.rot! }) >>> 0)).toBe(true);
    }
  });
});
