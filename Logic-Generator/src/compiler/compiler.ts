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

  insertRouters(nodes, edges, addNode, connect);

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

/** Max input ports on a normal (single-cell) signal processor block. */
const MAX_INPUT_PORTS = 2;

type AddNodeFn = (n: Omit<BlockNode, "id">) => string;
type ConnectFn = (fromId: string, fromPort: number, toId: string, toPort: number) => void;

/**
 * Replace implicit fan-out with Data Router 2 / 4 nodes (game forbids wire splitting).
 * Recursively chains routers when a signal feeds more than four consumers.
 */
function insertRouters(
  nodes: BlockNode[],
  edges: Edge[],
  addNode: AddNodeFn,
  connect: ConnectFn,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const assertInputCapacity = (toId: string, toPort: number) => {
    const target = byId.get(toId);
    if (!target) return;
    const maxIn = OPS[target.op].inputs.length;
    if (maxIn > 0 && maxIn <= MAX_INPUT_PORTS && toPort >= maxIn) {
      throw new FormulaError(
        `Block '${target.label}' accepts at most ${maxIn} input(s); port ${toPort} is out of range.`,
        0,
      );
    }
  };

  const fanoutGroups = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.from.blockId}:${e.from.port}`;
    const list = fanoutGroups.get(key) ?? [];
    list.push(e);
    fanoutGroups.set(key, list);
  }

  const splitEdges = (
    sourceId: string,
    sourcePort: number,
    group: Edge[],
  ): void => {
    const n = group.length;
    if (n <= 1) return;

    if (n <= 2) {
      const rid = addRouter("router2", addNode);
      connect(sourceId, sourcePort, rid, 0);
      for (let i = 0; i < n; i++) {
        const e = group[i];
        assertInputCapacity(e.to.blockId, e.to.port);
        connect(rid, i, e.to.blockId, e.to.port);
      }
      return;
    }

    if (n <= 4) {
      const rid = addRouter("router4", addNode);
      connect(sourceId, sourcePort, rid, 0);
      for (let i = 0; i < n; i++) {
        const e = group[i];
        assertInputCapacity(e.to.blockId, e.to.port);
        connect(rid, i, e.to.blockId, e.to.port);
      }
      return;
    }

    // n > 4: Router4 for first three consumers, recurse on output 3 for the rest.
    const rid = addRouter("router4", addNode);
    connect(sourceId, sourcePort, rid, 0);
    const direct = group.slice(0, 3);
    const rest = group.slice(3);
    for (let i = 0; i < direct.length; i++) {
      const e = direct[i];
      assertInputCapacity(e.to.blockId, e.to.port);
      connect(rid, i, e.to.blockId, e.to.port);
    }
    splitEdges(rid, 3, rest);
  };

  const toRemove = new Set<Edge>();
  for (const [, group] of fanoutGroups) {
    if (group.length <= 1) continue;
    for (const e of group) toRemove.add(e);
    const head = group[0];
    splitEdges(head.from.blockId, head.from.port, group);
  }

  if (toRemove.size > 0) {
    let w = 0;
    for (let r = 0; r < edges.length; r++) {
      if (!toRemove.has(edges[r])) edges[w++] = edges[r];
    }
    edges.length = w;
  }
}

function addRouter(op: "router2" | "router4", addNode: AddNodeFn): string {
  const spec = OPS[op];
  return addNode({
    op,
    label: spec.label,
    inputs: [...spec.inputs],
    outputs: [...spec.outputs],
  });
}
