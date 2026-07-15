import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Billboard } from "@react-three/drei";
import type { BlockNode } from "../compiler/graph";
import { OPS, type OpCategory, type OpKey } from "../formula/catalog";
import {
  footprintForOp,
  inputPortCell,
  inputPortInto,
  outputPortCell,
  outputPortInto,
} from "../catalog/ports";
import type { LaidOutGraph } from "../layout/layout";
import { ROTATIONS, type Quaternion } from "../serializer/rotations";

// `_gt.rot` as a three quaternion. ROTATIONS entries are already (x,y,z,w) in the
// game's frame, which maps 1:1 to the scene's (game Y up = three Y up).
// ponytail: assumes no extra basis flip between game and three. The rotation
// fixture exists precisely to catch it if there is one.
function rotQuat(rot: number | undefined): Quaternion | undefined {
  return rot === undefined ? undefined : ROTATIONS[rot] ?? undefined;
}

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

// Top-face glyph, where a recognizable math symbol exists. Ops without one just
// carry their floating label.
const SYMBOL: Partial<Record<OpKey, string>> = {
  add: "+", sub: "−", mul: "×", div: "÷", mod: "%", pow: "xⁿ",
  min: "min", max: "max", abs: "|x|", sqrt: "√", exp: "eˣ", log: "ln",
  sin: "sin", cos: "cos", tan: "tan", atan2: "atan2",
  not: "¬", xor: "⊕", condition: "?",
  deriv: "d/dt", integ: "∫", memory: "M",
  threshold: "⎍", constant: "k", input: "▸", output: "◉",
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
  const { center, radius, blocks, cables, loose } = useMemo(() => {
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
        // Box centre = anchor (min corner) + half the footprint − half a cell.
        const cx = c.x + (w - 1) / 2;
        const cy = c.y;
        const cz = c.z + (h - 1) / 2;
        // Ports live in the block's LOCAL frame (offset from its centre) so the
        // block's `_gt.rot` carries them along — a port is part of the block.
        const local = (p: Vec3, out: boolean) => {
          acc(p.x, p.y, p.z);
          return { pos: [p.x - cx, p.y - cy + 0.55, p.z - cz] as [number, number, number], out };
        };
        const ports = [
          ...n.inputs.map((_, i) => local(inputPortCell(n.op, c, i), false)),
          ...n.outputs.map((_, i) => local(outputPortCell(n.op, c, i), true)),
        ];
        return {
          id: n.id,
          label: n.label || OPS[n.op].label,
          symbol: SYMBOL[n.op],
          quat: rotQuat(n.rot),
          color: blockColor(n),
          cx,
          cy,
          cz,
          w,
          h,
          ports,
        };
      });

    // Per cell: arms toward every neighbour in its own edge chain, PLUS an arm
    // into the block at each chain endpoint (the port's "into" direction) — so a
    // cable that connects into an output reads differently from one running past.
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(laid.edges.map((e) => [e.id, e]));
    const cables: Array<Vec3 & { dirs: Dir[] }> = [];
    for (const chain of laid.cableChains) {
      if (chain.cells.length === 0) continue;
      const set = new Set(chain.cells.map((c) => cellKey(c.x, c.y, c.z)));
      const edge = edgeById.get(chain.edgeId);
      const from = edge && byId.get(edge.from.blockId);
      const to = edge && byId.get(edge.to.blockId);
      const startInto = from ? outputPortInto(from.op, edge!.from.port) : undefined;
      const endInto = to ? inputPortInto(to.op, edge!.to.port) : undefined;
      const last = chain.cells.length - 1;
      chain.cells.forEach((c, idx) => {
        acc(c.x, c.y, c.z);
        const dirs = DIRS.filter(([, dx, dy, dz]) => set.has(cellKey(c.x + dx, c.y + dy, c.z + dz)))
          .map(([d]) => d);
        if (idx === 0 && startInto) dirs.push(startInto);
        if (idx === last && endInto) dirs.push(endInto);
        cables.push({ x: c.x, y: c.y, z: c.z, dirs });
      });
    }

    // Cable cells with no chain (the calibration fixtures place bare cells): draw
    // each one oriented by its own `_gt.rot` instead of by connectivity, so the
    // scene predicts the in-game mesh angle and the two can be diffed.
    const chained = new Set(cables.map((c) => cellKey(c.x, c.y, c.z)));
    const loose = laid.cableCells
      .filter((c) => !chained.has(cellKey(c.x, c.y, c.z)))
      .map((c) => {
        acc(c.x, c.y, c.z);
        return { x: c.x, y: c.y, z: c.z, rot: c.rot, trailing: c.trailing };
      });

    if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = minZ = maxZ = 0; }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const radius = Math.max(6, maxX - minX, maxZ - minZ, maxY - minY);
    return { center, radius, blocks, cables, loose };
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

      {/* Body + top glyph share one group, so an explicit `_gt.rot` (calibration
          fixtures) turns the glyph with the block and the angle stays readable. */}
      {blocks.map((b) => (
        <group key={b.id} position={[wx(b.cx), wy(b.cy), wz(b.cz)]} quaternion={b.quat}>
          <mesh>
            <boxGeometry args={[b.w, 1, b.h]} />
            <meshStandardMaterial color={b.color} />
          </mesh>
          {b.symbol && (
            <Text position={[0, 0.51, 0]} rotation={[-Math.PI / 2, 0, 0]}
              fontSize={Math.min(b.w, b.h) * 0.6} color="#0e1116"
              anchorX="center" anchorY="middle">
              {b.symbol}
            </Text>
          )}
          {b.ports.map((p, i) => (
            <mesh key={i} position={p.pos}>
              <sphereGeometry args={[0.18, 8, 8]} />
              <meshStandardMaterial color={p.out ? "#1a01f8" : "#fffd10"} />
            </mesh>
          ))}
        </group>
      ))}

      {blocks.map((b) => (
        <Billboard key={`lbl-${b.id}`} position={[wx(b.cx), wy(b.cy) + 0.8, wz(b.cz)]}>
          <Text fontSize={0.35} color="#e6edf3" anchorX="center" anchorY="bottom"
            outlineWidth={0.02} outlineColor="#0e1116">
            {b.label}
          </Text>
        </Billboard>
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

      {/* Bare cable cells (calibration fixture): a straight-X bar with a +Y tick
          for chirality, spun by ROTATIONS[rot], labelled with rot/trailing. */}
      {loose.map((c, i) => (
        <group key={`loose-${i}`} position={[wx(c.x), wy(c.y), wz(c.z)]}>
          <group quaternion={rotQuat(c.rot)}>
            <mesh>
              <boxGeometry args={[ARM * 2, FLAT, WIDE]} />
              <meshStandardMaterial color={CABLE_COLOR} />
            </mesh>
            <mesh position={[ARM * 0.7, 0.15, 0]}>
              <boxGeometry args={[FLAT, 0.3, WIDE]} />
              <meshStandardMaterial color="#f59e0b" />
            </mesh>
          </group>
          <Billboard position={[0, 0.7, 0]}>
            <Text fontSize={0.3} color="#e6edf3" anchorX="center" anchorY="bottom"
              outlineWidth={0.02} outlineColor="#0e1116">
              {`${c.rot}${c.trailing ? "·t1" : ""}`}
            </Text>
          </Billboard>
        </group>
      ))}

      <OrbitControls makeDefault />
    </Canvas>
  );
}
