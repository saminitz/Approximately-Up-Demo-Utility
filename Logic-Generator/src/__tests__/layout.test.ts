import { describe, expect, it } from "vitest";



import { compileFormula } from "../compiler/compiler";

import { cableMetaFromDirs, cableShapeFromDirs, dirBetween } from "../layout/cableShapes";

import { INTERIOR_BASE_CELL, layoutGraph } from "../layout/layout";

import { DEFAULT_BP_OPTIONS, buildBp, GT_DATA_OFFSET } from "../serializer/bpWriter";

import { getReferenceHeader } from "../serializer/header";

import { packGt, unpackGt } from "../serializer/gtCodec";

import { ROT_LOGIC, ROT_UPRIGHT } from "../serializer/rotations";



const PD = "u = Kp*(t - p) + Kd*deriv(t - p)";



describe("placement fixes (rotation + interior offset)", () => {

  it("uses ROT_LOGIC (180° Y flip from upright) as the serializer default", () => {
    expect(DEFAULT_BP_OPTIONS.rot).toBe(ROT_LOGIC);
    expect(DEFAULT_BP_OPTIONS.rot).toBe(3);
    expect(ROT_UPRIGHT).toBe(6);
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



describe("cable orientation (rot in _gt)", () => {

  it("maps straight and corner connectivity to reference rot indices", () => {

    expect(cableMetaFromDirs(["+X", "-X"])).toMatchObject({ rot: 0, trailing: 0 });

    expect(cableMetaFromDirs(["+Z", "-Z"])).toMatchObject({ rot: 16, trailing: 0 });

    expect(cableMetaFromDirs(["+X", "+Z"])).toMatchObject({ rot: 0, trailing: 1 });

    expect(cableMetaFromDirs(["+X"])).toMatchObject({ rot: 15, trailing: 1 });

    expect(cableMetaFromDirs(["+X", "-X", "+Z"])).toMatchObject({ rot: 0, trailing: 0 });

  });



  it("keeps cableShapeFromDirs as a backward-compatible alias", () => {

    expect(cableShapeFromDirs(["+X", "-X"]).shape).toBe(0);

  });



  it("derives axis directions between adjacent cells", () => {

    const a = { x: 10, y: 24, z: 20 };

    expect(dirBetween(a, { x: 11, y: 24, z: 20 })).toBe("+X");

    expect(dirBetween(a, { x: 10, y: 24, z: 21 })).toBe("+Z");

  });



  it("flips sink terminals 180° (rot 6) so their port faces the cable", () => {
    // "A Generated.bp" was invalid: output block at rot 3 → port dangled.
    const laid = layoutGraph(compileFormula("a = b + c"));
    const header = getReferenceHeader();
    const { bytes } = buildBp(laid, DEFAULT_BP_OPTIONS);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let off = header.byteLength;
    const blockRots: number[] = [];
    while (off + 12 <= bytes.length) {
      const structIndex = dv.getInt32(off + 8, true);
      const sizeof = header.structs[structIndex].sizeof;
      const dataStart = off + 12;
      if (structIndex !== 2) {
        blockRots.push(unpackGt(dv.getUint32(dataStart + GT_DATA_OFFSET, true)).rot);
      }
      off = dataStart + sizeof + 4;
    }
    // 3 wireless + 1 adder; exactly the one output terminal is flipped to rot 6.
    expect(blockRots.filter((r) => r === ROT_UPRIGHT)).toHaveLength(1);
    expect(blockRots.filter((r) => r === ROT_LOGIC)).toHaveLength(3);
  });

  it("emits varied cable rot values for routed PD sample", () => {

    const laid = layoutGraph(compileFormula(PD));

    expect(laid.cableCells.length).toBeGreaterThan(0);



    const rots = new Set(laid.cableCells.map((c) => c.rot));

    expect(rots.has(0)).toBe(true);
    expect(rots.size).toBeGreaterThan(1);



    const header = getReferenceHeader();

    const { bytes } = buildBp(laid, { emitCables: true, rot: ROT_LOGIC });

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);



    let off = header.byteLength;

    let sawCable = false;

    while (off + 12 <= bytes.length) {

      const structIndex = dv.getInt32(off + 8, true);

      const sizeof = header.structs[structIndex].sizeof;

      const dataStart = off + 12;

      if (structIndex === 2) {

        sawCable = true;

        // (rot 3 is a valid cable orientation — e.g. a bridge down-foot — so
        // we don't assert cable rot differs from the block default here.)
        expect(sizeof).toBe(24);

      }

      off = dataStart + sizeof + 4;

    }

    expect(sawCable).toBe(true);

  });

});

