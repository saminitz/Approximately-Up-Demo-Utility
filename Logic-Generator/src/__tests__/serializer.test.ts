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

import { ROT_UPRIGHT } from "../serializer/rotations";

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

    const { bytes } = buildBp(laid, { emitCables: true, rot: ROT_UPRIGHT });

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

    const { bytes } = buildBp(laid, { emitCables: false, rot: ROT_UPRIGHT });

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

        rot: ROT_UPRIGHT,

      });

    }

  });



  it("writes constant values after _gt (data+0x18)", () => {

    const laid = layoutGraph(compileFormula("k = 0.5"));

    const { bytes } = buildBp(laid, { emitCables: false, rot: ROT_UPRIGHT });

    const header = getReferenceHeader();

    const structIndex = PREFAB_TABLE.constant.structIndex;

    const sizeof = header.structs[structIndex].sizeof;



    const dataStart = header.byteLength + 12;

    expect(dvFloat(bytes, dataStart + 0x18)).toBeCloseTo(0.5);

    expect(sizeof).toBe(28);

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

});



function dvFloat(bytes: Uint8Array, off: number): number {

  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(off, true);

}

