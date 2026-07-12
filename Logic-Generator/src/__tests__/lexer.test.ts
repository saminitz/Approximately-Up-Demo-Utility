import { describe, expect, it } from "vitest";
import { tokenize } from "../formula/lexer";
import { FormulaError } from "../formula/tokens";

const types = (s: string) => tokenize(s).map((t) => t.type);

describe("lexer", () => {
  it("tokenizes an assignment", () => {
    expect(types("y = a + 2")).toEqual([
      "ident",
      "assign",
      "ident",
      "op",
      "number",
      "eof",
    ]);
  });

  it("parses numbers with decimals and exponents", () => {
    const toks = tokenize("x = 3.14 + 1e-3");
    const nums = toks.filter((t) => t.type === "number").map((t) => t.value);
    expect(nums).toEqual(["3.14", "1e-3"]);
  });

  it("collapses newlines and semicolons into separators", () => {
    expect(types("a = 1\n\n;b = 2")).toEqual([
      "ident",
      "assign",
      "number",
      "newline",
      "ident",
      "assign",
      "number",
      "eof",
    ]);
  });

  it("ignores line comments", () => {
    expect(types("y = 1 // this is x\n")).toEqual([
      "ident",
      "assign",
      "number",
      "eof",
    ]);
  });

  it("throws on illegal characters", () => {
    expect(() => tokenize("y = a & b")).toThrow(FormulaError);
  });
});
