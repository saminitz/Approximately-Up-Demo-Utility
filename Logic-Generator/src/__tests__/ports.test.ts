import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import {
  PORT_BY_OP,
  PORT_MAP_STATS,
  inputPortCell,
  outputPortCell,
  topologyForOp,
} from "../catalog/ports";
import { layoutGraph } from "../layout/layout";

describe("port map (Block List cable markers)", () => {
  it("parsed 103 cable cells into port metadata", () => {
    expect(PORT_MAP_STATS?.cables).toBe(103);
    expect(PORT_MAP_STATS?.cableChains).toBe(47);
  });

  it("maps binary ops: output on -X, inputs on +X", () => {
    const add = topologyForOp("add");
    expect(add.outputs).toEqual([{ face: "-X", dx: -1, dz: 0, chainLen: 2 }]);
    expect(add.inputs).toEqual([
      { face: "+X", dx: 2, dz: 1, chainLen: 1 },
      { face: "+X", dx: 3, dz: 1, chainLen: 1 },
    ]);
  });

  it("maps unary ops: input -X dz+1, output +X dz+1", () => {
    const not = topologyForOp("not");
    expect(not.inputs[0]).toMatchObject({ face: "-X", dx: -1, dz: 1, chainLen: 1 });
    expect(not.outputs[0]).toMatchObject({ face: "+X", dx: 2, dz: 1, chainLen: 2 });
  });

  it("maps stateful blocks: len-2 input on -X", () => {
    const mem = topologyForOp("memory");
    expect(mem.inputs[0]).toMatchObject({ face: "-X", dx: -1, dz: 0, chainLen: 2 });
    expect(mem.outputs[0]).toMatchObject({ face: "+X", dx: 2, dz: 1, chainLen: 2 });
  });

  it("fills threshold second input from catalog", () => {
    const t = topologyForOp("threshold");
    expect(t.inputs).toHaveLength(2);
    expect(t.outputs).toHaveLength(1);
  });

  it("fills remap to five input offsets", () => {
    const r = topologyForOp("remap");
    expect(r.inputs).toHaveLength(5);
    expect(r.outputs).toHaveLength(1);
  });

  it("routes cables from port cells not block centers", () => {
    const laid = layoutGraph(compileFormula("c = a + b"));
    const adder = laid.nodes.find((n) => n.op === "add")!;
    const anchor = adder.cell!;
    const outCell = outputPortCell("add", anchor, 0);
    const in0 = inputPortCell("add", anchor, 0);
    expect(outCell).toEqual({ x: anchor.x - 1, y: anchor.y, z: anchor.z });
    expect(in0).toEqual({ x: anchor.x + 2, y: anchor.y, z: anchor.z + 1 });
    expect(laid.routes.length).toBeGreaterThan(0);
    for (const route of laid.routes) {
      expect(route.cells[0]).not.toEqual(anchor);
    }
  });

  it("exposes router4 with four +X outputs", () => {
    const r4 = PORT_BY_OP.router4;
    expect(r4?.outputs).toHaveLength(4);
    expect(r4?.inputs).toHaveLength(1);
  });
});
