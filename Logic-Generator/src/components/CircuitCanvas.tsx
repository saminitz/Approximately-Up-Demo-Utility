import { useMemo } from "react";
import type { BlockNode } from "../compiler/graph";
import { OPS, type OpCategory } from "../formula/catalog";
import type { LaidOutGraph } from "../layout/layout";
import { routeCables, type RouteRequest, type UiRect } from "../layout/uiRoute";

const CELL = 24; // pixels per grid cell
const BLOCK_W = 104;
const PORT_R = 4;
const PAD = 48; // px breathing room around the whole circuit (covers block half-width + label/cable overhang)

const CATEGORY_COLOR: Record<OpCategory, string> = {
  arithmetic: "#3b82f6",
  trig: "#a855f7",
  logic: "#ef4444",
  stateful: "#f59e0b",
  shaping: "#14b8a6",
  routing: "#64748b",
  io: "#22c55e",
  constant: "#94a3b8",
};

function blockColor(node: BlockNode): string {
  if (node.op === "output") return "#ec4899";
  return CATEGORY_COLOR[OPS[node.op].category];
}

function blockHeight(node: BlockNode): number {
  const ports = Math.max(node.inputs.length, node.outputs.length, 1);
  return Math.max(44, ports * 18 + 20);
}

interface Anchor {
  x: number;
  y: number;
}

export interface CircuitCanvasProps {
  laid: LaidOutGraph;
  zoom: number;
}

export function CircuitCanvas({ laid, zoom }: CircuitCanvasProps) {
  const geom = useMemo(() => {
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    let minX = Infinity;
    let minZ = Infinity;
    for (const n of laid.nodes) {
      const c = n.cell ?? { x: 0, y: 0, z: 0 };
      minX = Math.min(minX, c.x);
      minZ = Math.min(minZ, c.z);
    }
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minZ)) minZ = 0;

    // Raw pixel centers, then measure the real drawn bounding box (block rects,
    // which already contain the edge-anchored ports) so we can pad + shift by
    // the actual extent instead of a cell count that ignores block size.
    const raw = (x: number, z: number): Anchor => ({
      x: (x - minX) * CELL,
      y: (z - minZ) * CELL,
    });
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const n of laid.nodes) {
      const c = n.cell ?? { x: 0, y: 0, z: 0 };
      const a = raw(c.x, c.z);
      const h = blockHeight(n);
      bx0 = Math.min(bx0, a.x - BLOCK_W / 2);
      bx1 = Math.max(bx1, a.x + BLOCK_W / 2);
      by0 = Math.min(by0, a.y - h / 2);
      by1 = Math.max(by1, a.y + h / 2);
    }
    if (!Number.isFinite(bx0)) { bx0 = 0; bx1 = 0; by0 = 0; by1 = 0; }
    const offX = PAD - bx0;
    const offY = PAD - by0;

    const toPx = (x: number, z: number): Anchor => {
      const a = raw(x, z);
      return { x: a.x + offX, y: a.y + offY };
    };

    const centers = new Map<string, Anchor>();
    for (const n of laid.nodes) {
      const c = n.cell ?? { x: 0, y: 0, z: 0 };
      centers.set(n.id, toPx(c.x, c.z));
    }
    const inPort = (id: string, idx: number, total: number): Anchor => {
      const ctr = centers.get(id)!;
      const h = blockHeight(byId.get(id)!);
      const y = ctr.y - h / 2 + ((idx + 1) * h) / (total + 1);
      return { x: ctr.x - BLOCK_W / 2, y };
    };
    const outPort = (id: string, idx: number, total: number): Anchor => {
      const ctr = centers.get(id)!;
      const h = blockHeight(byId.get(id)!);
      const y = ctr.y - h / 2 + ((idx + 1) * h) / (total + 1);
      return { x: ctr.x + BLOCK_W / 2, y };
    };

    const width = (bx1 - bx0) + PAD * 2;
    const height = (by1 - by0) + PAD * 2;
    return { centers, inPort, outPort, byId, width, height, minX, minZ, toPx };
  }, [laid]);

  const cablePaths = useMemo(() => {
    const { centers, byId, inPort, outPort } = geom;

    // Block rectangles in pixel space (same geometry the blocks are drawn with).
    const rects: UiRect[] = laid.nodes.map((n) => {
      const ctr = centers.get(n.id)!;
      const h = blockHeight(byId.get(n.id)!);
      return { x: ctr.x - BLOCK_W / 2, y: ctr.y - h / 2, w: BLOCK_W, h };
    });

    // One routing request per edge, anchored on the *drawn* port positions.
    // Route left-to-right, top-to-bottom so lane assignment is stable.
    const requests: RouteRequest[] = laid.edges
      .map((e) => {
        const from = byId.get(e.from.blockId)!;
        const to = byId.get(e.to.blockId)!;
        return {
          id: e.id,
          from: outPort(from.id, e.from.port, from.outputs.length),
          to: inPort(to.id, e.to.port, to.inputs.length),
        };
      })
      .sort((a, b) => a.from.x - b.from.x || a.from.y - b.from.y);

    const routed = routeCables(rects, requests);
    return routed.map((r) => ({
      id: r.id,
      d: `M ${r.points.map((p) => `${p.x},${p.y}`).join(" L ")}`,
    }));
  }, [laid, geom]);

  const w = geom.width;
  const h = geom.height;

  return (
    <svg
      width={w * zoom}
      height={h * zoom}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Compiled logic circuit"
    >
      <g className="cables" fill="none" stroke="#4b93f8" strokeOpacity={0.55} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
        {cablePaths.map((c) => (
          <path key={c.id} d={c.d} />
        ))}
      </g>

      <g className="blocks">
        {laid.nodes.map((node) => {
          const ctr = geom.centers.get(node.id)!;
          const height = blockHeight(node);
          const color = blockColor(node);
          const x = ctr.x - BLOCK_W / 2;
          const y = ctr.y - height / 2;
          const title =
            node.op === "constant"
              ? String(node.value)
              : node.signalName ?? node.label;
          const sub =
            node.op === "input" || node.op === "output"
              ? node.op
              : node.op === "constant"
                ? "Constant"
                : node.label;
          return (
            <g key={node.id}>
              <rect
                x={x}
                y={y}
                width={BLOCK_W}
                height={height}
                rx={9}
                fill="#161b22"
                stroke={color}
                strokeWidth={1.6}
              />
              <rect x={x} y={y} width={4} height={height} rx={2} fill={color} />
              <text x={ctr.x} y={ctr.y - 3} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#e6edf3">
                {title}
              </text>
              <text x={ctr.x} y={ctr.y + 12} textAnchor="middle" fontSize={9.5} fill="#8b98a5">
                {sub}
              </text>

              {node.inputs.map((label, i) => {
                const p = geom.inPort(node.id, i, node.inputs.length);
                return (
                  <g key={`in-${i}`}>
                    <circle cx={p.x} cy={p.y} r={PORT_R} fill="#0e1116" stroke={color} strokeWidth={1.4} />
                    <text x={p.x + 7} y={p.y + 3} fontSize={8.5} fill="#8b98a5">
                      {label}
                    </text>
                  </g>
                );
              })}
              {node.outputs.map((label, i) => {
                const p = geom.outPort(node.id, i, node.outputs.length);
                return (
                  <g key={`out-${i}`}>
                    <circle cx={p.x} cy={p.y} r={PORT_R} fill={color} stroke="#0e1116" strokeWidth={1.2} />
                    <text x={p.x - 7} y={p.y + 3} textAnchor="end" fontSize={8.5} fill="#8b98a5">
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
