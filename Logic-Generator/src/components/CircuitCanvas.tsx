import { useMemo } from "react";
import type { BlockNode } from "../compiler/graph";
import { OPS, type OpCategory } from "../formula/catalog";
import type { LaidOutGraph } from "../layout/layout";

const CELL = 24; // pixels per grid cell
const BLOCK_W = 104;
const PORT_R = 4;
const MARGIN = 2; // cells

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

    const toPx = (x: number, z: number): Anchor => ({
      x: (x - minX + MARGIN) * CELL,
      y: (z - minZ + MARGIN) * CELL,
    });

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

    const spanX = laid.bounds.maxX - minX;
    const spanZ = laid.bounds.maxZ - minZ;
    const width = (spanX + MARGIN * 2) * CELL + BLOCK_W;
    const height = (spanZ + MARGIN * 2) * CELL + 80;
    return { centers, inPort, outPort, byId, width, height, minX, minZ, toPx };
  }, [laid]);

  const cablePaths = useMemo(() => {
    const { toPx } = geom;
    return laid.routes.map((r) => {
      const pts = r.cells.map((c) => {
        const p = toPx(c.x, c.z);
        return `${p.x},${p.y}`;
      });
      return { id: r.edgeId, d: `M ${pts.join(" L ")}` };
    });
  }, [laid, geom]);

  const w = Math.max(geom.width, 400);
  const h = Math.max(geom.height, 300);

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
