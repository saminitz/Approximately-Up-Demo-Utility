import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { BlockNode } from "../compiler/graph";
import { OPS, type OpCategory } from "../formula/catalog";
import { footprintForOp, inputPortCell, outputPortCell } from "../catalog/ports";
import type { LaidOutGraph } from "../layout/layout";

// Faithful 3D render of the SAME model the exporter writes: block cells from
// `node.cell` (sized by the real footprint) and cables from `laid.cableCells`
// (bridge cells sit at y+1, so crossings visibly arch). No cosmetic re-routing.
//
// ponytail: plain meshes, one per block/cell. Circuits are tens–hundreds of
// cells; switch to instancedMesh only if a big circuit measurably drags.

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

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Circuit3DProps {
  laid: LaidOutGraph;
}

export function Circuit3D({ laid }: Circuit3DProps) {
  // Center the whole scene on the model centroid so it sits near the origin
  // regardless of the game-grid anchor (~200,24,200).
  const { center, radius, blocks, ports, cables } = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const acc = (x: number, y: number, z: number) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    };

    const blocks = laid.nodes
      .filter((n) => n.cell)
      .map((n) => {
        const { w, h } = footprintForOp(n.op);
        const c = n.cell!;
        acc(c.x, c.y, c.z);
        acc(c.x + w - 1, c.y, c.z + h - 1);
        return {
          id: n.id,
          color: blockColor(n),
          // Box centre = anchor (min corner) + half the footprint − half a cell.
          cx: c.x + (w - 1) / 2,
          cy: c.y,
          cz: c.z + (h - 1) / 2,
          w,
          h,
        };
      });

    const ports: Array<Vec3 & { out: boolean }> = [];
    for (const n of laid.nodes) {
      if (!n.cell) continue;
      n.inputs.forEach((_, i) => ports.push({ ...inputPortCell(n.op, n.cell!, i), out: false }));
      n.outputs.forEach((_, i) => ports.push({ ...outputPortCell(n.op, n.cell!, i), out: true }));
    }

    const cables = laid.cableCells.map((c) => {
      acc(c.x, c.y, c.z);
      return { x: c.x, y: c.y, z: c.z };
    });

    if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = minZ = maxZ = 0; }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const radius = Math.max(6, maxX - minX, maxZ - minZ, maxY - minY);
    return { center, radius, blocks, ports, cables };
  }, [laid]);

  // World = game cell − centroid. Game Y (up) maps straight to three's Y-up.
  const wx = (x: number) => x - center.x;
  const wy = (y: number) => y - center.y;
  const wz = (z: number) => z - center.z;

  const dist = radius * 1.6;

  return (
    <Canvas
      camera={{ position: [dist, dist * 0.9, dist], fov: 45, far: dist * 20 }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0e1116"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[dist, dist * 2, dist]} intensity={0.8} />
      <gridHelper args={[radius * 3, Math.ceil(radius * 3), "#30363d", "#21262d"]} position={[0, wy(laid.nodes[0]?.cell?.y ?? 0) - 0.5, 0]} />

      {blocks.map((b) => (
        <mesh key={b.id} position={[wx(b.cx), wy(b.cy), wz(b.cz)]}>
          <boxGeometry args={[b.w, 1, b.h]} />
          <meshStandardMaterial color={b.color} />
        </mesh>
      ))}

      {ports.map((p, i) => (
        <mesh key={i} position={[wx(p.x), wy(p.y) + 0.55, wz(p.z)]}>
          <sphereGeometry args={[0.18, 8, 8]} />
          <meshStandardMaterial color={p.out ? "#e6edf3" : "#8b98a5"} />
        </mesh>
      ))}

      {cables.map((c, i) => (
        <mesh key={i} position={[wx(c.x), wy(c.y), wz(c.z)]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="#4b93f8" />
        </mesh>
      ))}

      <OrbitControls makeDefault />
    </Canvas>
  );
}
