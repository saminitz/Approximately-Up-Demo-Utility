import { describe, expect, it } from "vitest";



import { compileFormula } from "../compiler/compiler";

import { cableMetaFromDirs, cableShapeFromDirs, dirBetween } from "../layout/cableShapes";

import { INTERIOR_BASE_CELL, layoutGraph } from "../layout/layout";

import { DEFAULT_BP_OPTIONS, buildBp, GT_DATA_OFFSET } from "../serializer/bpWriter";

import { getReferenceHeader } from "../serializer/header";

import { packGt, unpackGt } from "../serializer/gtCodec";

import { ROT_LOGIC, ROT_UPRIGHT } from "../serializer/rotations";



const PD = "u = Kp*(t - p) + Kd*deriv(t - p)";

// The "6-DOF stabilizer (complex)" example from App.tsx — 92 edges; used to
// leave 2 unrouted before layoutGraph grew its retry sweep.
const SIX_DOF = `altError  = targetAlt - altitude
altRate   = deriv(altitude)
altInteg  = integral(altError)
altPID    = Kp*altError + Ki*altInteg - Kd*altRate
tiltMag   = abs(pitch) + abs(roll)
tilt      = atan2(pitch, roll)
gyroMix   = gx*gx + gy*gy + gz*gz
spin      = pow(gyroMix, 0.5)
damp      = tanh(spin) * max(tiltMag, 0.001)
heading   = atan2(yaw, tilt)
wrap      = mod(heading, 6.2831853)
osc       = sin(wrap) * cos(altRate) + tan(min(damp, 1.5))
gate      = xor(threshold(altError, 0.0), not(condition(spin, spinLimit)))
gated     = condition(gate, altPID)
shaped    = remap(gated, -10, 10, -1, 1)
memHold   = memory(shaped)
expTerm   = exp(-abs(shaped)) + log(1 + tiltMag)
thrust    = memHold + osc*0.25 - damp*0.1 + expTerm`;



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



    expect(INTERIOR_BASE_CELL).toEqual({ x: 200, y: 24, z: 200 });

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



  it("writes every block at the base rot, sink terminals included", () => {
    // Sinks used to be flipped to rot 6; that rotated the mesh 180° away from
    // the +X cell the router cables into (and from what the viewer draws).
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
    // 3 wireless + 1 adder, all at ROT_LOGIC — none flipped.
    expect(blockRots.filter((r) => r === ROT_UPRIGHT)).toHaveLength(0);
    expect(blockRots.filter((r) => r === ROT_LOGIC)).toHaveLength(4);
  });

  it("routes every edge of the 6-DOF stabilizer (retry sweep)", () => {
    const laid = layoutGraph(compileFormula(SIX_DOF, true));
    expect(laid.failedRoutes).toBeUndefined();
    for (const r of laid.routes) {
      expect(r.cells.length, `edge ${r.edgeId} has no route`).toBeGreaterThan(0);
    }
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

