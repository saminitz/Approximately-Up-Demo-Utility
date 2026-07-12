import { describe, expect, it } from "vitest";
import { parseFormula } from "../formula/parser";
import type { BinaryNode } from "../formula/ast";
import { FormulaError } from "../formula/tokens";

describe("parser", () => {
  it("applies standard precedence (* before +)", () => {
    const p = parseFormula("y = a + b * c");
    const expr = p.assignments[0].expr as BinaryNode;
    expect(expr.type).toBe("binary");
    expect(expr.op).toBe("+");
    expect((expr.right as BinaryNode).op).toBe("*");
  });

  it("treats ^ as right-associative", () => {
    const p = parseFormula("y = a ^ b ^ c");
    const expr = p.assignments[0].expr as BinaryNode;
    expect(expr.op).toBe("^");
    expect((expr.right as BinaryNode).op).toBe("^"); // a ^ (b ^ c)
  });

  it("parses catalog function calls", () => {
    const p = parseFormula("y = deriv(x) + max(a, b)");
    expect(p.assignments).toHaveLength(1);
  });

  it("accepts multiple assignments", () => {
    const p = parseFormula("e = t - p\nu = kp * e");
    expect(p.assignments.map((a) => a.name)).toEqual(["e", "u"]);
  });

  it("rejects functions outside the catalog", () => {
    expect(() => parseFormula("y = frobnicate(x)")).toThrow(/Unknown function/);
  });

  it("rejects wrong arity", () => {
    expect(() => parseFormula("y = sin(a, b)")).toThrow(/expects 1 argument/);
    expect(() => parseFormula("y = pow(a)")).toThrow(/expects 2 argument/);
  });

  it("rejects a bare expression without assignment", () => {
    expect(() => parseFormula("a + b")).toThrow(FormulaError);
  });

  it("rejects an empty formula", () => {
    expect(() => parseFormula("   \n // nothing \n")).toThrow(/Empty formula/);
  });
});
