import { FN_TO_OP, OPS } from "./catalog";
import type { Assignment, Expr, Program } from "./ast";
import { tokenize } from "./lexer";
import { FormulaError, type Token } from "./tokens";

// Grammar (precedence low -> high):
//   program    := (assignment (NEWLINE assignment)*)?
//   assignment := IDENT '=' expr
//   expr       := term (('+' | '-') term)*
//   term       := factor (('*' | '/') factor)*
//   factor     := ('+' | '-') factor | power
//   power      := primary ('^' factor)?        (right associative)
//   primary    := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'

class Parser {
  private tokens: Token[];
  private i = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private expect(type: Token["type"], msg: string): Token {
    const t = this.peek();
    if (t.type !== type) throw new FormulaError(msg, t.pos);
    return this.next();
  }

  parseProgram(): Program {
    const assignments: Assignment[] = [];
    while (this.peek().type !== "eof") {
      if (this.peek().type === "newline") {
        this.next();
        continue;
      }
      assignments.push(this.parseAssignment());
      if (this.peek().type === "newline") this.next();
      else if (this.peek().type !== "eof") {
        const t = this.peek();
        throw new FormulaError(
          `Expected end of statement but found '${t.value}'`,
          t.pos,
        );
      }
    }
    if (assignments.length === 0) {
      throw new FormulaError(
        "Empty formula. Write at least one assignment, e.g. `y = a + b`.",
        0,
      );
    }
    return { assignments };
  }

  private parseAssignment(): Assignment {
    const nameTok = this.peek();
    if (nameTok.type !== "ident") {
      throw new FormulaError(
        "Each line must be an assignment: `name = expression`.",
        nameTok.pos,
      );
    }
    this.next();
    this.expect(
      "assign",
      `Expected '=' after '${nameTok.value}' (each line assigns a named signal).`,
    );
    const expr = this.parseExpr();
    return { name: nameTok.value, expr, pos: nameTok.pos };
  }

  private parseExpr(): Expr {
    let left = this.parseTerm();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next();
      const right = this.parseTerm();
      left = { type: "binary", op: op.value as "+" | "-", left, right, pos: op.pos };
    }
    return left;
  }

  private parseTerm(): Expr {
    let left = this.parseFactor();
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next();
      const right = this.parseFactor();
      left = { type: "binary", op: op.value as "*" | "/", left, right, pos: op.pos };
    }
    return left;
  }

  private parseFactor(): Expr {
    const t = this.peek();
    if (t.type === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const operand = this.parseFactor();
      return { type: "unary", op: t.value as "+" | "-", operand, pos: t.pos };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePrimary();
    if (this.peek().type === "op" && this.peek().value === "^") {
      const op = this.next();
      const exp = this.parseFactor(); // right associative
      return { type: "binary", op: "^", left: base, right: exp, pos: op.pos };
    }
    return base;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      const value = Number(t.value);
      if (!Number.isFinite(value)) {
        throw new FormulaError(`Invalid number '${t.value}'`, t.pos);
      }
      return { type: "number", value, pos: t.pos };
    }
    if (t.type === "lparen") {
      this.next();
      const e = this.parseExpr();
      this.expect("rparen", "Missing closing ')'.");
      return e;
    }
    if (t.type === "ident") {
      this.next();
      if (this.peek().type === "lparen") {
        return this.parseCall(t.value, t.pos);
      }
      return { type: "var", name: t.value, pos: t.pos };
    }
    throw new FormulaError(
      t.type === "eof" ? "Unexpected end of formula." : `Unexpected token '${t.value}'.`,
      t.pos,
    );
  }

  private parseCall(name: string, pos: number): Expr {
    this.expect("lparen", "Expected '('.");
    const args: Expr[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseExpr());
      while (this.peek().type === "comma") {
        this.next();
        args.push(this.parseExpr());
      }
    }
    this.expect("rparen", `Missing ')' in call to ${name}(...).`);

    // Validate against the catalog — reject anything the game can't do.
    const opKey = FN_TO_OP[name];
    if (!opKey) {
      throw new FormulaError(
        `Unknown function '${name}'. Allowed: ${Object.keys(FN_TO_OP).sort().join(", ")}.`,
        pos,
      );
    }
    const spec = OPS[opKey];
    const arity = spec.inputs.length + (spec.params?.length ?? 0);
    if (args.length !== arity) {
      throw new FormulaError(`'${name}' expects ${arity} argument(s) but got ${args.length}.`, pos);
    }
    return { type: "call", name, args, pos };
  }
}

export function parseFormula(src: string): Program {
  return new Parser(tokenize(src)).parseProgram();
}
