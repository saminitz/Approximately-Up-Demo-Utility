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
import { cableDirsForRot } from "../layout/cableShapes";
import { DIR_TO_SCENE, sceneQuat as rotQuat, toScene, type Vec3Tuple } from "../gameFrame";
import { cableGeoms } from "./cableGeom";

// A cable cell is drawn from its ACTUAL connectivity: one round arm from the cell
// centre toward each neighbour it links to (within its own edge chain, so parallel
// cables never falsely join). Straight run = two opposite arms (a rod); a turn =
// two perpendicular arms swept through a rounded elbow (the way the game bends a
// cable inside one block); a bridge = a horizontal arm + a vertical one. Arms reach
// just past the cell boundary, so a chain's cells meet as one continuous tube.
type Dir = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
const DIRS: ReadonlyArray<readonly [Dir, number, number, number]> = [
  ["+X", 1, 0, 0], ["-X", -1, 0, 0],
  ["+Y", 0, 1, 0], ["-Y", 0, -1, 0],
  ["+Z", 0, 0, 1], ["-Z", 0, 0, -1],
];

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

/** One cable cell: round tubes out to each linked direction, bent at the centre. */
function Cable({ dirs }: { dirs: Dir[] }) {
  return (
    <>
      {cableGeoms(dirs).map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color={CABLE_COLOR} />
        </mesh>
      ))}
    </>
  );
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
          return { pos: toScene(p.x - cx, p.y - cy + 0.55, p.z - cz), out };
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
      const startInto = from ? outputPortInto(from.op, edge!.from.port, from.turns ?? 0) : undefined;
      const endInto = to ? inputPortInto(to.op, edge!.to.port, to.turns ?? 0) : undefined;
      const last = chain.cells.length - 1;
      chain.cells.forEach((c, idx) => {
        acc(c.x, c.y, c.z);
        const dirs = DIRS.filter(([, dx, dy, dz]) => set.has(cellKey(c.x + dx, c.y + dy, c.z + dz)))
          .map(([d]) => d);
        if (idx === 0 && startInto) dirs.push(startInto);
        if (idx === last && endInto) dirs.push(endInto);
        // A chain end with no block to enter is NOT a flat stub: every measured
        // ENDPOINT rot is an L with a vertical arm (15/17/14 bend down, 21 up),
        // trailing 1 like a corner. Take that second arm off the cell's own rot.
        if ((idx === 0 && !startInto) || (idx === last && !endInto)) {
          dirs.push(...cableDirsForRot(c.rot));
        }
        const arms = [...new Set(dirs)];
        cables.push({ x: c.x, y: c.y, z: c.z, dirs: arms.map((d) => DIR_TO_SCENE[d]) });
      });
    }

    // Cable cells with no chain (the calibration fixtures place bare cells): the
    // arms come from the cell's own `_gt.rot` instead of from connectivity, but
    // the geometry is the same L the routed cables draw — so the scene predicts
    // the in-game mesh angle and the two can be diffed by eye.
    const chained = new Set(cables.map((c) => cellKey(c.x, c.y, c.z)));
    const loose = laid.cableCells
      .filter((c) => !chained.has(cellKey(c.x, c.y, c.z)))
      .map((c) => {
        acc(c.x, c.y, c.z);
        // Labelled in the GAME frame (like the axes helper), not the model frame
        // the table is keyed in — the label must name the axes actually drawn.
        const dirs = cableDirsForRot(c.rot).map((d) => DIR_TO_SCENE[d]);
        return { x: c.x, y: c.y, z: c.z, rot: c.rot, dirs, label: `${c.rot}: ${dirs.join(" ")}` };
      });

    if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = minZ = maxZ = 0; }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const radius = Math.max(6, maxX - minX, maxZ - minZ, maxY - minY);
    return { center, radius, blocks, cables, loose };
  }, [laid]);

  // World = (model cell − centroid), transposed into the game's frame.
  const world = (x: number, y: number, z: number): Vec3Tuple =>
    toScene(x - center.x, y - center.y, z - center.z);
  const wy = (y: number) => y - center.y;

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

      {/* Game axes at the scene centre: red +X, green +Y, blue +Z — the same axes
          the "Axis markers" fixture spells out with block values. */}
      <group>
        <axesHelper args={[3]} />
        {(["+X", "+Y", "+Z"] as const).map((label, i) => (
          <Billboard key={label} position={[i === 0 ? 3.4 : 0, i === 1 ? 3.4 : 0, i === 2 ? 3.4 : 0]}>
            <Text fontSize={0.4} color={["#ff6b6b", "#51cf66", "#4b93f8"][i]}
              anchorX="center" anchorY="middle">
              {label}
            </Text>
          </Billboard>
        ))}
      </group>

      {/* Body + top glyph share one group, so an explicit `_gt.rot` (calibration
          fixtures) turns the glyph with the block and the angle stays readable. */}
      {blocks.map((b) => (
        <group key={b.id} position={world(b.cx, b.cy, b.cz)} quaternion={b.quat}>
          <mesh>
            {/* Footprint w is along model X = scene Z, h along model Z = scene X. */}
            <boxGeometry args={[b.h, 1, b.w]} />
            <meshStandardMaterial color={b.color} />
          </mesh>
          {b.symbol && (
            <Text position={[0, 0.51, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}
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
        <Billboard key={`lbl-${b.id}`} position={world(b.cx, b.cy + 0.8, b.cz)}>
          <Text fontSize={0.35} color="#e6edf3" anchorX="center" anchorY="bottom"
            outlineWidth={0.02} outlineColor="#0e1116">
            {b.label}
          </Text>
        </Billboard>
      ))}

      {/* Each cell = round tubes toward its linked directions (straight, L-bend,
          tee, or bridge ramp — the cable's real geometry). */}
      {cables.map((c, i) => (
        <group key={i} position={world(c.x, c.y, c.z)}>
          <Cable dirs={c.dirs} />
        </group>
      ))}

      {/* Bare cable cells (calibration fixture): same L as above, but with the arms
          derived from the cell's `_gt.rot`, labelled `rot: <arm dirs>` so the
          in-game mesh can be read off against the label. */}
      {loose.map((c, i) => (
        <group key={`loose-${i}`} position={world(c.x, c.y, c.z)}>
          <Cable dirs={c.dirs} />
          <Billboard position={[0, 0.9, 0]}>
            <Text fontSize={0.3} color="#e6edf3" anchorX="center" anchorY="bottom"
              outlineWidth={0.02} outlineColor="#0e1116">
              {c.label}
            </Text>
          </Billboard>
        </group>
      ))}

      <OrbitControls makeDefault />
    </Canvas>
  );
}
