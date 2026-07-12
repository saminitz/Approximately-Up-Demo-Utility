import { describe, expect, it } from "vitest";

import { compileFormula } from "../compiler/compiler";
import { cableShapeFromDirs, dirBetween } from "../layout/cableShapes";
import { INTERIOR_BASE_CELL, layoutGraph } from "../layout/layout";
import { DEFAULT_BP_OPTIONS, buildBp, GT_DATA_OFFSET } from "../serializer/bpWriter";
import { getReferenceHeader } from "../serializer/header";
import { packGt, unpackGt } from "../serializer/gtCodec";
import { ROT_UPRIGHT } from "../serializer/rotations";

const PD = "u = Kp*(t - p) + Kd*deriv(t - p)";

describe("placement fixes (rotation + interior offset)", () => {
  it("uses the upright rotation (6) as the serializer default", () => {
    expect(DEFAULT_BP_OPTIONS.rot).toBe(ROT_UPRIGHT);
    expect(DEFAULT_BP_OPTIONS.rot).toBe(6);
  });

  it("assigns distinct grid cells to each block", () => {
    const laid = layoutGraph(compileFormula(PD));
    const keys = new Set(
      laid.nodes.map((n) => {
        const c = n.cell!;
        return `${c.x},${c.y},${c.z}`;
      }),
    );
    expect(keys.size).toBe(laid.nodes.length);
  });

  it("lays the circuit on the X-Z plane with constant Y", () => {
    const laid = layoutGraph(compileFormula(PD));

    const xs = laid.nodes.map((n) => n.cell!.x);
    const zs = laid.nodes.map((n) => n.cell!.z);
    const ys = laid.nodes.map((n) => n.cell!.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBe(INTERIOR_BASE_CELL.y);

    for (const n of laid.nodes) {
      const c = n.cell!;
      expect(c.x).toBeGreaterThanOrEqual(INTERIOR_BASE_CELL.x);
      expect(c.y).toBe(INTERIOR_BASE_CELL.y);
      expect(c.z).toBeGreaterThanOrEqual(INTERIOR_BASE_CELL.z);
      expect(c.x).toBeLessThanOrEqual(511);
      expect(c.z).toBeLessThanOrEqual(511);
    }

    for (const r of laid.routes) {
      for (const c of r.cells) {
        expect(c.y).toBe(INTERIOR_BASE_CELL.y);
      }
    }

    expect(INTERIOR_BASE_CELL).toEqual({ x: 200, y: 24, z: 192 });
  });

  it("round-trips interior cells through the gt codec at rot=6", () => {
    const laid = layoutGraph(compileFormula(PD));
    const n = laid.nodes[0];
    const c = n.cell!;
    const packed = packGt({ x: c.x, y: c.y, z: c.z, rot: ROT_UPRIGHT });
    expect(unpackGt(packed)).toEqual({ x: c.x, y: c.y, z: c.z, rot: 6 });
  });
});

describe("cable shape selection", () => {
  it("maps straight and corner connectivity to shape bytes", () => {
    expect(cableShapeFromDirs(["+X", "-X"])).toMatchObject({ shape: 0, trailing: 0 });
    expect(cableShapeFromDirs(["+Z", "-Z"])).toMatchObject({ shape: 0, trailing: 0 });
    expect(cableShapeFromDirs(["+X", "+Z"])).toMatchObject({ shape: 1, trailing: 1 });
    expect(cableShapeFromDirs(["+X"])).toMatchObject({ shape: 1, trailing: 1 });
    expect(cableShapeFromDirs(["+X", "-X", "+Z"])).toMatchObject({ shape: 0, trailing: 0 });
  });

  it("derives axis directions between adjacent cells", () => {
    const a = { x: 10, y: 24, z: 20 };
    expect(dirBetween(a, { x: 11, y: 24, z: 20 })).toBe("+X");
    expect(dirBetween(a, { x: 10, y: 24, z: 21 })).toBe("+Z");
  });

  it("emits non-zero cable shapes for routed PD sample", () => {
    const laid = layoutGraph(compileFormula(PD));
    expect(laid.cableCells.length).toBeGreaterThan(0);

    const shapes = new Set(laid.cableCells.map((c) => c.shape));
    expect(shapes.has(0)).toBe(true);
    expect(shapes.has(1)).toBe(true);

    const header = getReferenceHeader();
    const { bytes } = buildBp(laid, { emitCables: true, rot: ROT_UPRIGHT });
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let off = header.byteLength;
    let sawCable = false;
    while (off + 12 <= bytes.length) {
      const structIndex = dv.getInt32(off + 8, true);
      const sizeof = header.structs[structIndex].sizeof;
      const dataStart = off + 12;
      if (structIndex === 2) {
        sawCable = true;
        const shape = dv.getUint8(dataStart + GT_DATA_OFFSET + 4);
        expect([0, 1]).toContain(shape);
        expect(sizeof).toBe(24);
      }
      off = dataStart + sizeof + 4;
    }
    expect(sawCable).toBe(true);
  });
});
