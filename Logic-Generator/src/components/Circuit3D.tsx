import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { BlockNode } from "../compiler/graph";
import { OPS, type OpCategory } from "../formula/catalog";
import { footprintForOp, inputPortCell, outputPortCell } from "../catalog/ports";
import type { LaidOutGraph } from "../layout/layout";

// A cable cell is drawn from its ACTUAL connectivity: one flat arm from the cell
// centre toward each neighbour it links to (within its own edge chain, so parallel
// cables never falsely join). Straight run = two opposite arms (a bar); a turn =
// two perpendicular half-length arms meeting at the centre (an L, the way the game
// bends a cable inside one block); a bridge = a horizontal arm + a vertical one.
type Dir = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
const DIRS: ReadonlyArray<readonly [Dir, number, number, number]> = [
  ["+X", 1, 0, 0], ["-X", -1, 0, 0],
  ["+Y", 0, 1, 0], ["-Y", 0, -1, 0],
  ["+Z", 0, 0, 1], ["-Z", 0, 0, -1],
];

const ARM = 0.55; // half-cell + slight overlap so adjacent cells' arms touch
const FLAT = 0.1; // cable thickness (the two faces)
const WIDE = 0.3; // cable width

// Arm box size + centre offset for each direction (flat = thin on the travel-normal
// vertical for horizontal arms; vertical arms are thin front-to-back).
const ARM_GEOM: Record<Dir, { size: [number, number, number]; pos: [number, number, number] }> = {
  "+X": { size: [ARM, FLAT, WIDE], pos: [0.25, 0, 0] },
  "-X": { size: [ARM, FLAT, WIDE], pos: [-0.25, 0, 0] },
  "+Z": { size: [WIDE, FLAT, ARM], pos: [0, 0, 0.25] },
  "-Z": { size: [WIDE, FLAT, ARM], pos: [0, 0, -0.25] },
  "+Y": { size: [WIDE, ARM, FLAT], pos: [0, 0.25, 0] },
  "-Y": { size: [WIDE, ARM, FLAT], pos: [0, -0.25, 0] },
};
const CABLE_COLOR = "#4b93f8";
const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

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

    // Per cell: the directions it links to within its own edge chain.
    const cables: Array<Vec3 & { dirs: Dir[] }> = [];
    for (const chain of laid.cableChains) {
      const set = new Set(chain.cells.map((c) => cellKey(c.x, c.y, c.z)));
      for (const c of chain.cells) {
        acc(c.x, c.y, c.z);
        const dirs = DIRS.filter(([, dx, dy, dz]) => set.has(cellKey(c.x + dx, c.y + dy, c.z + dz)))
          .map(([d]) => d);
        cables.push({ x: c.x, y: c.y, z: c.z, dirs });
      }
    }

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

      {/* Each cell = a centre node + one flat arm per linked direction (straight,
          L-bend, tee, or bridge ramp — the cable's real geometry). */}
      {cables.map((c, i) => (
        <group key={i} position={[wx(c.x), wy(c.y), wz(c.z)]}>
          <mesh>
            <boxGeometry args={[WIDE, FLAT, WIDE]} />
            <meshStandardMaterial color={CABLE_COLOR} />
          </mesh>
          {c.dirs.map((d) => (
            <mesh key={d} position={ARM_GEOM[d].pos}>
              <boxGeometry args={ARM_GEOM[d].size} />
              <meshStandardMaterial color={CABLE_COLOR} />
            </mesh>
          ))}
        </group>
      ))}

      <OrbitControls makeDefault />
    </Canvas>
  );
}
