import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import {
  PORT_BY_OP,
  PORT_MAP_STATS,
  footprintForOp,
  inputPortCell,
  inputPortInto,
  inputPortRot,
  outputPortCell,
  outputPortInto,
  outputPortRot,
  portInto,
  topologyForOp,
} from "../catalog/ports";
import { layoutGraph } from "../layout/layout";

describe("port map (Block List cable markers)", () => {
  it("parsed 103 cable cells into port metadata", () => {
    expect(PORT_MAP_STATS?.cables).toBe(103);
    expect(PORT_MAP_STATS?.cableChains).toBe(47);
  });

  it("maps binary ops: inputs on -X (west), output on +X (east)", () => {
    const add = topologyForOp("add");
    expect(add.outputs).toEqual([{ face: "+X", dx: 2, dz: 1, chainLen: 2, cableRot: 0 }]);
    expect(add.inputs).toEqual([
      { face: "-X", dx: -1, dz: 0, chainLen: 1, cableRot: 5 },
      { face: "-X", dx: -1, dz: 1, chainLen: 1, cableRot: 5 },
    ]);
  });

  it("portInto: block side from the offset (works for tall routers)", () => {
    expect(portInto({ face: "-X", dx: -1, dz: 0 })).toBe("+X"); // west port -> block east
    expect(portInto({ face: "+X", dx: 2, dz: 3 })).toBe("-X"); // east port (router row 3)
    expect(portInto({ face: "+Z", dx: 0, dz: -1 })).toBe("+Z"); // near-Z port
    expect(portInto({ face: "-Z", dx: 1, dz: 4 })).toBe("-Z"); // far-Z port
    // router4 outputs are all on the east face regardless of Z row.
    expect(outputPortInto("router4", 0)).toBe("-X");
    expect(outputPortInto("router4", 3)).toBe("-X");
    expect(inputPortInto("router4", 0)).toBe("+X");
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
    expect(outCell).toEqual({ x: anchor.x + 2, y: anchor.y, z: anchor.z + 1 });
    expect(in0).toEqual({ x: anchor.x - 1, y: anchor.y, z: anchor.z });
    expect(laid.routes.length).toBeGreaterThan(0);
    for (const route of laid.routes) {
      expect(route.cells[0]).not.toEqual(anchor);
    }
  });

  it("forces first-cable rot: 5 on west face, 0 on east face", () => {
    // Block List ground truth: -X ports rot 5, +X ports rot 0.
    expect(outputPortRot("add", 0)).toBe(0); // adder output on +X (east)
    expect(inputPortRot("add", 0)).toBe(5); // adder inputs on -X (west)
    expect(inputPortRot("not", 0)).toBe(5); // unary input on -X
    expect(outputPortRot("not", 0)).toBe(0); // unary output on +X
  });

  it("stamps port rot onto the first cable cell of each route", () => {
    const laid = layoutGraph(compileFormula("c = a + b"));
    const adder = laid.nodes.find((n) => n.op === "add")!;
    const inCell = inputPortCell("add", adder.cell!, 0);
    const cable = laid.cableCells.find(
      (c) => c.x === inCell.x && c.z === inCell.z,
    );
    expect(cable?.rot).toBe(5); // -X input stub (west)
  });

  it("derives footprint from port span: binary/unary 2×2, routers/remap 2×4", () => {
    expect(footprintForOp("add")).toEqual({ w: 2, h: 2 });
    expect(footprintForOp("not")).toEqual({ w: 2, h: 2 });
    expect(footprintForOp("router4").h).toBe(4);
    expect(footprintForOp("remap").h).toBe(4);
  });

  it("exposes router4 with four +X outputs", () => {
    const r4 = PORT_BY_OP.router4;
    expect(r4?.outputs).toHaveLength(4);
    expect(r4?.inputs).toHaveLength(1);
  });
});
