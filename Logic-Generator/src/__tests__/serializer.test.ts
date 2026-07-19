import { describe, expect, it } from "vitest";

import { compileFormula } from "../compiler/compiler";

import { layoutGraph } from "../layout/layout";

import {

  buildBp,

  ENTITY_ID_BYTES,

  GT_DATA_OFFSET,

} from "../serializer/bpWriter";

import { getReferenceHeader } from "../serializer/header";

import { buildBpMeta } from "../serializer/bpmeta";

import { unpackGt } from "../serializer/gtCodec";

import { ROT_LOGIC, ROT_UPRIGHT } from "../serializer/rotations";

import { PREFAB_TABLE } from "../serializer/prefabTable";



const PD = "u = Kp*(t - p) + Kd*deriv(t - p)";



describe("serializer", () => {

  it("parses the bundled reference header (36 structs / 3220 bytes)", () => {

    const h = getReferenceHeader();

    expect(h.structCount).toBe(36);

    expect(h.byteLength).toBe(3220);

  });



  it("emits the header verbatim and records that consume to EOF", () => {

    const laid = layoutGraph(compileFormula(PD));

    const { bytes } = buildBp(laid, { emitCables: true, rot: ROT_LOGIC });

    const header = getReferenceHeader();



    expect(bytes.subarray(0, header.byteLength)).toEqual(header.bytes);



    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let off = header.byteLength;

    let records = 0;

    while (off + 12 <= bytes.length) {

      const structIndex = dv.getInt32(off + 8, true);

      expect(structIndex).toBeGreaterThanOrEqual(0);

      expect(structIndex).toBeLessThan(header.structCount);

      const sizeof = header.structs[structIndex].sizeof;

      off += 12 + sizeof + 4;

      records++;

    }

    expect(off).toBe(bytes.length);

    expect(records).toBeGreaterThan(0);

  });



  it("writes _gt at data+0x14 with distinct coords per block", () => {

    const laid = layoutGraph(compileFormula(PD));

    const { bytes } = buildBp(laid, { emitCables: false, rot: ROT_LOGIC });

    const header = getReferenceHeader();



    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let off = header.byteLength;

    const gts: number[] = [];



    while (off + 12 <= bytes.length) {

      const structIndex = dv.getInt32(off + 8, true);

      const sizeof = header.structs[structIndex].sizeof;

      const dataStart = off + 12;



      expect(dv.getUint32(dataStart, true)).toBe(0);

      expect(dataStart + ENTITY_ID_BYTES + 4).toBeLessThanOrEqual(dataStart + sizeof);



      const gt = dv.getUint32(dataStart + GT_DATA_OFFSET, true);

      gts.push(gt);

      off = dataStart + sizeof + 4;

    }



    expect(new Set(gts).size).toBe(laid.nodes.length);



    for (let i = 0; i < laid.nodes.length; i++) {

      const c = laid.nodes[i].cell!;

      expect(unpackGt(gts[i])).toEqual({

        x: c.x,

        y: c.y,

        z: c.z,

        // Sink terminals are flipped 180° so their port faces the cable.

        rot: laid.nodes[i].op === "output" ? ROT_UPRIGHT : ROT_LOGIC,

      });

    }

  });



  it("writes constant values after _gt (data+0x18)", () => {

    const laid = layoutGraph(compileFormula("k = 0.5"));

    const { bytes } = buildBp(laid, { emitCables: false, rot: ROT_LOGIC });

    const header = getReferenceHeader();

    const structIndex = PREFAB_TABLE.constant.structIndex;

    const sizeof = header.structs[structIndex].sizeof;



    const dataStart = header.byteLength + 12;

    expect(dvFloat(bytes, dataStart + 0x18)).toBeCloseTo(0.5);

    expect(sizeof).toBe(28);

  });



  it("writes the remapper's four bounds into its own fields", () => {
    // Field order pinned off the Block List remapper, whose knobs read 12/13/21/22.
    const laid = layoutGraph(compileFormula("y = remap(x, -10, 10, -1, 1)"));
    const { bytes } = buildBp(laid, { emitCables: false, rot: ROT_LOGIC });
    const header = getReferenceHeader();
    const struct = header.structs[PREFAB_TABLE.remap.structIndex];
    expect(struct.sizeof).toBe(40);

    const remap = laid.nodes.findIndex((n) => n.op === "remap");
    expect(remap).toBeGreaterThanOrEqual(0);
    // Records are fixed-size per struct, so walk to the remapper's record.
    let off = header.byteLength;
    for (let i = 0; i < remap; i++) {
      off += 12 + header.structs[PREFAB_TABLE[laid.nodes[i].op].structIndex].sizeof + 4;
    }
    const data = off + 12;
    expect(dvFloat(bytes, data + 0x18)).toBeCloseTo(-10); // inMin
    expect(dvFloat(bytes, data + 0x1c)).toBeCloseTo(10); // inMax
    expect(dvFloat(bytes, data + 0x20)).toBeCloseTo(-1); // outMin
    expect(dvFloat(bytes, data + 0x24)).toBeCloseTo(1); // outMax
  });

  it("writes a valid .bpmeta JSON sidecar", () => {

    const meta = buildBpMeta({ name: "PD", folder: "80 Controllers" });

    const obj = JSON.parse(new TextDecoder().decode(meta));

    expect(obj).toMatchObject({

      _name: "PD",

      _folder: "80 Controllers",

      _version: "0.1.139",

    });

  });



  it("uses Block List ground-truth prefab hashes", () => {
    expect(PREFAB_TABLE.add.hash).toBe(0x3b7bbce726d0cc7fn);
    expect(PREFAB_TABLE.sub.hash).toBe(0x1c97aba9f33d90c8n);
    expect(PREFAB_TABLE.mul.hash).toBe(0x0407f3d568e89e48n);
    expect(PREFAB_TABLE.div.hash).toBe(0x00766e1e0f9c8699n);
    expect(PREFAB_TABLE.router2.hash).toBe(0x592905a5e74d8aaan);
    expect(PREFAB_TABLE.router4.hash).toBe(0x0124dacc6531029an);
    expect(PREFAB_TABLE.min.hash).toBe(0x5bd117aa5c9fdf0an);
    expect(PREFAB_TABLE.max.hash).toBe(0x6d2fdb1b68703078n);
    expect(PREFAB_TABLE.not.hash).toBe(0x72696a5f8c4b74den);
    expect(PREFAB_TABLE.xor.hash).toBe(0xeb8fe77ce46f3590n);
    expect(PREFAB_TABLE.threshold.hash).toBe(0x72a389e0f97da2d6n);
    expect(PREFAB_TABLE.threshold.structIndex).toBe(15);
    expect(PREFAB_TABLE.remap.hash).toBe(0xf45687f85cf62f59n);
    expect(PREFAB_TABLE.remap.structIndex).toBe(20);
    expect(PREFAB_TABLE.memory.hash).toBe(0x876ad2fe23bf2867n);
    expect(PREFAB_TABLE.signalRouter3.hash).toBe(0x4224391ea20c8575n);
    expect(PREFAB_TABLE.input.hash).toBe(PREFAB_TABLE.output.hash);
    expect(PREFAB_TABLE.input.structIndex).toBe(10);
    expect(PREFAB_TABLE.add.known).toBe(true);
    expect(PREFAB_TABLE.sub.known).toBe(true);
    expect(PREFAB_TABLE.mul.known).toBe(true);
    expect(PREFAB_TABLE.div.known).toBe(true);
    expect(PREFAB_TABLE.router2.known).toBe(true);
    expect(PREFAB_TABLE.router4.known).toBe(true);
    expect(PREFAB_TABLE.not.known).toBe(true);
    expect(PREFAB_TABLE.threshold.known).toBe(true);
    expect(PREFAB_TABLE.input.known).toBe(true);
  });

});



function dvFloat(bytes: Uint8Array, off: number): number {

  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(off, true);

}

