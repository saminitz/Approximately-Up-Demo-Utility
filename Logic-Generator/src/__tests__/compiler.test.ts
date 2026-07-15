import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import type { OpKey } from "../formula/catalog";

const count = (ops: OpKey[], op: OpKey) => ops.filter((o) => o === op).length;

describe("compiler", () => {
  it("derives inputs and outputs from named variables", () => {
    const g = compileFormula("error = target - position\ncontrol = Kp*error + Kd*deriv(error)");
    expect(g.inputs).toEqual(["Kd", "Kp", "position", "target"]);
    expect(g.outputs).toEqual(["control"]);
  });

  it("stores the threshold level in the block, not a wired constant", () => {
    const g = compileFormula("y = threshold(x, 4.321)");
    const t = g.nodes.filter((n) => n.op === "threshold");
    expect(t).toHaveLength(1);
    expect(t[0].params).toEqual([4.321]);
    expect(t[0].inputs).toHaveLength(1);
    expect(count(g.nodes.map((n) => n.op), "constant")).toBe(0);
    expect(g.edges.filter((e) => e.to.blockId === t[0].id)).toHaveLength(1);
  });

  it("rejects a non-literal threshold level", () => {
    expect(() => compileFormula("y = threshold(x, k)")).toThrow(/literal number/);
  });

  it("stores the remapper's four bounds in the block", () => {
    const g = compileFormula("y = remap(x, -10, 10, -1, 1)");
    const r = g.nodes.filter((n) => n.op === "remap");
    expect(r).toHaveLength(1);
    expect(r[0].params).toEqual([-10, 10, -1, 1]);
    expect(r[0].inputs).toHaveLength(1);
    expect(count(g.nodes.map((n) => n.op), "constant")).toBe(0);
    expect(g.edges.filter((e) => e.to.blockId === r[0].id)).toHaveLength(1);
  });

  it("rejects a non-literal remapper bound", () => {
    expect(() => compileFormula("y = remap(x, -10, 10, -1, k)")).toThrow(/outMax/);
  });

  it("creates input and output terminal blocks", () => {
    const g = compileFormula("y = a + b");
    const inputs = g.nodes.filter((n) => n.op === "input").map((n) => n.signalName);
    const outputs = g.nodes.filter((n) => n.op === "output").map((n) => n.signalName);
    expect(inputs.sort()).toEqual(["a", "b"]);
    expect(outputs).toEqual(["y"]);
  });

  it("shares common subexpressions (CSE)", () => {
    // (a + b) used twice -> a single adder plus one multiplier.
    const g = compileFormula("y = (a + b) * (a + b)");
    const ops = g.nodes.map((n) => n.op);
    expect(count(ops, "add")).toBe(1);
    expect(count(ops, "mul")).toBe(1);
  });

  it("inserts Router2 when a signal fans out to two consumers", () => {
    const g = compileFormula("u = Kp*(t - p) + Kd*deriv(t - p)");
    const ops = g.nodes.map((n) => n.op);
    expect(ops.filter((o) => o === "router2")).toHaveLength(1);
    expect(ops.filter((o) => o === "sub")).toHaveLength(1);

    const outDeg = new Map<string, number>();
    for (const e of g.edges) {
      const k = `${e.from.blockId}:${e.from.port}`;
      outDeg.set(k, (outDeg.get(k) ?? 0) + 1);
    }
    for (const [, v] of outDeg) expect(v).toBeLessThanOrEqual(1);
  });

  it("reuses a named intermediate signal instead of duplicating it", () => {
    const g = compileFormula("e = t - p\nu = Kp*e + Kd*e");
    const ops = g.nodes.map((n) => n.op);
    expect(count(ops, "sub")).toBe(1); // single 'e' subtractor, fanned out
  });

  it("lowers a numeric literal to a constant block", () => {
    const g = compileFormula("y = x * 2");
    const consts = g.nodes.filter((n) => n.op === "constant");
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(2);
  });

  it("lowers unary minus to a subtractor from zero", () => {
    const g = compileFormula("y = -x");
    const ops = g.nodes.map((n) => n.op);
    expect(count(ops, "sub")).toBe(1);
    expect(count(ops, "constant")).toBe(1); // the zero
  });

  it("rejects duplicate assignment of the same signal", () => {
    expect(() => compileFormula("y = a\ny = b")).toThrow(/assigned more than once/);
  });

  it("detects cyclic definitions", () => {
    expect(() => compileFormula("a = b + 1\nb = a + 1")).toThrow(/[Cc]yclic/);
  });

  it("compiles the hover-hold example with no mass/thrust/gravity input", () => {
    const g = compileFormula(
      "vUp   = integral(aUp)\n" +
        "vErr  = vTarget - vUp\n" +
        "cmd   = Kp*vErr + Ki*integral(vErr)\n" +
        "throt = min(1, max(0, cmd))",
    );
    // Only the sensor, the setpoint and the two gains are wired in. If mass,
    // maxThrust or gravity ever show up here the loop stopped being portable.
    expect(g.inputs).toEqual(["Ki", "Kp", "aUp", "vTarget"]);
    expect(g.outputs).toEqual(["throt"]);
    // Two accumulators: velocity from accel, and the one that learns hover throttle.
    expect(count(g.nodes.map((n) => n.op), "integ")).toBe(2);
  });

  it("produces a valid edge set (all endpoints exist)", () => {
    const g = compileFormula("u = Kp*(t - p) + Kd*deriv(t - p)");
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from.blockId)).toBe(true);
      expect(ids.has(e.to.blockId)).toBe(true);
    }
  });
});
