export type TokenType =
  | "number"
  | "ident"
  | "op" // + - * / ^
  | "lparen"
  | "rparen"
  | "comma"
  | "assign" // =
  | "newline" // statement separator (newline or ;)
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class FormulaError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = "FormulaError";
    this.pos = pos;
  }
}
