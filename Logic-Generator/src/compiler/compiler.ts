import type { Assignment, Expr } from "../formula/ast";
import { FN_TO_OP, OPS, type OpKey } from "../formula/catalog";
import { parseFormula } from "../formula/parser";
import { FormulaError } from "../formula/tokens";
import type { BlockGraph, BlockNode, Edge } from "./graph";

const COMMUTATIVE: ReadonlySet<OpKey> = new Set(["add", "mul", "min", "max", "xor"]);

const BINOP_TO_OP: Record<string, OpKey> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "^": "pow",
};

/**
 * Lower a parsed formula program into a block graph with common-subexpression
 * sharing and auto-generated input/output terminal blocks.
 */
export function compileFormula(src: string): BlockGraph {
  const program = parseFormula(src);
  return compileProgram(program.assignments);
}

function compileProgram(assignments: Assignment[]): BlockGraph {
  const assigned = new Map<string, Expr>();
  for (const a of assignments) {
    if (assigned.has(a.name)) {
      throw new FormulaError(`Signal '${a.name}' is assigned more than once.`, a.pos);
    }
    assigned.set(a.name, a.expr);
  }

  // Which names are referenced by some RHS?
  const referenced = new Set<string>();
  for (const a of assignments) collectRefs(a.expr, referenced);

  // Free variables (used but never assigned) -> inputs.
  const inputs: string[] = [];
  for (const name of referenced) {
    if (!assigned.has(name)) inputs.push(name);
  }
  inputs.sort();

  // Assigned but never referenced downstream -> outputs.
  const outputs: string[] = [];
  for (const a of assignments) {
    if (!referenced.has(a.name)) outputs.push(a.name);
  }
  if (outputs.length === 0) {
    // Everything feeds into something else -> no sink. Treat the last assignment
    // as the output so the user always gets a result.
    outputs.push(assignments[assignments.length - 1].name);
  }

  const nodes: BlockNode[] = [];
  const edges: Edge[] = [];
  let nodeSeq = 0;
  let edgeSeq = 0;

  const cse = new Map<string, string>(); // signature -> node id
  const inputNodes = new Map<string, string>(); // input name -> node id
  const assignedNodes = new Map<string, string>(); // assigned name -> lowered node id
  const inProgress = new Set<string>(); // cycle detection for assigned names

  const addNode = (n: Omit<BlockNode, "id">): string => {
    const id = `n${nodeSeq++}`;
    nodes.push({ id, ...n });
    return id;
  };
  const connect = (fromId: string, fromPort: number, toId: string, toPort: number) => {
    edges.push({
      id: `e${edgeSeq++}`,
      from: { blockId: fromId, port: fromPort },
      to: { blockId: toId, port: toPort },
    });
  };

  const getInputNode = (name: string): string => {
    let id = inputNodes.get(name);
    if (!id) {
      id = addNode({
        op: "input",
        label: name,
        inputs: [],
        outputs: ["out"],
        signalName: name,
      });
      inputNodes.set(name, id);
    }
    return id;
  };

  const getConstNode = (value: number): string => {
    const sig = `const:${value}`;
    const hit = cse.get(sig);
    if (hit) return hit;
    const id = addNode({
      op: "constant",
      label: formatConst(value),
      inputs: [],
      outputs: ["out"],
      value,
    });
    cse.set(sig, id);
    return id;
  };

  // Lower an expression to a node id, returning [nodeId, signature].
  const lowerExpr = (expr: Expr): { id: string; sig: string } => {
    switch (expr.type) {
      case "number": {
        const id = getConstNode(expr.value);
        return { id, sig: `const:${expr.value}` };
      }
      case "var": {
        if (assigned.has(expr.name)) {
          const id = lowerAssigned(expr.name);
          return { id, sig: `sig:${expr.name}` };
        }
        const id = getInputNode(expr.name);
        return { id, sig: `in:${expr.name}` };
      }
      case "unary": {
        if (expr.op === "+") return lowerExpr(expr.operand);
        // unary minus -> Subtractor(0, x)
        const child = lowerExpr(expr.operand);
        const sig = `neg(${child.sig})`;
        const hit = cse.get(sig);
        if (hit) return { id: hit, sig };
        const zero = getConstNode(0);
        const id = makeOpNode("sub");
        connect(zero, 0, id, 0);
        connect(child.id, 0, id, 1);
        cse.set(sig, id);
        return { id, sig };
      }
      case "binary": {
        const op = BINOP_TO_OP[expr.op];
        const l = lowerExpr(expr.left);
        const r = lowerExpr(expr.right);
        const sig = signature(op, [l.sig, r.sig]);
        const hit = cse.get(sig);
        if (hit) return { id: hit, sig };
        const id = makeOpNode(op);
        connect(l.id, 0, id, 0);
        connect(r.id, 0, id, 1);
        cse.set(sig, id);
        return { id, sig };
      }
      case "call": {
        const op = FN_TO_OP[expr.name];
        const loweredArgs = expr.args.map(lowerExpr);
        const sig = signature(op, loweredArgs.map((a) => a.sig));
        const hit = cse.get(sig);
        if (hit) return { id: hit, sig };
        const id = makeOpNode(op);
        loweredArgs.forEach((a, i) => connect(a.id, 0, id, i));
        cse.set(sig, id);
        return { id, sig };
      }
    }
  };

  const makeOpNode = (op: OpKey): string => {
    const spec = OPS[op];
    return addNode({
      op,
      label: spec.label,
      inputs: [...spec.inputs],
      outputs: [...spec.outputs],
    });
  };

  const lowerAssigned = (name: string): string => {
    const cached = assignedNodes.get(name);
    if (cached) return cached;
    if (inProgress.has(name)) {
      throw new FormulaError(
        `Cyclic definition detected involving '${name}'. Feedback loops are not supported yet.`,
        0,
      );
    }
    inProgress.add(name);
    const expr = assigned.get(name)!;
    const { id } = lowerExpr(expr);
    inProgress.delete(name);
    assignedNodes.set(name, id);
    return id;
  };

  // Build an output terminal for each output signal.
  for (const name of outputs) {
    const src = assigned.has(name) ? lowerAssigned(name) : getInputNode(name);
    const outId = addNode({
      op: "output",
      label: name,
      inputs: ["in"],
      outputs: [],
      signalName: name,
    });
    connect(src, 0, outId, 0);
  }

  return { nodes, edges, inputs, outputs };
}

function collectRefs(expr: Expr, out: Set<string>): void {
  switch (expr.type) {
    case "var":
      out.add(expr.name);
      return;
    case "unary":
      collectRefs(expr.operand, out);
      return;
    case "binary":
      collectRefs(expr.left, out);
      collectRefs(expr.right, out);
      return;
    case "call":
      for (const a of expr.args) collectRefs(a, out);
      return;
    case "number":
      return;
  }
}

function signature(op: OpKey, childSigs: string[]): string {
  const parts = COMMUTATIVE.has(op) ? [...childSigs].sort() : childSigs;
  return `${op}(${parts.join(",")})`;
}

function formatConst(v: number): string {
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
}
