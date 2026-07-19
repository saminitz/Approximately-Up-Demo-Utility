// Abstract syntax tree for the formula language.

export type BinaryOperator = "+" | "-" | "*" | "/" | "^";
export type UnaryOperator = "+" | "-";

export interface NumberNode {
  type: "number";
  value: number;
  pos: number;
}

export interface VarNode {
  type: "var";
  name: string;
  pos: number;
}

export interface UnaryNode {
  type: "unary";
  op: UnaryOperator;
  operand: Expr;
  pos: number;
}

export interface BinaryNode {
  type: "binary";
  op: BinaryOperator;
  left: Expr;
  right: Expr;
  pos: number;
}

export interface CallNode {
  type: "call";
  name: string;
  args: Expr[];
  pos: number;
}

export type Expr = NumberNode | VarNode | UnaryNode | BinaryNode | CallNode;

export interface Assignment {
  name: string;
  expr: Expr;
  pos: number;
}

export interface Program {
  assignments: Assignment[];
}
