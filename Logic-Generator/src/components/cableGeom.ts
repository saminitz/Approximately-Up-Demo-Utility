import * as THREE from "three";

/** Scene-frame cardinal direction (already transposed by `DIR_TO_SCENE`). */
export type SceneDir = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

const SCENE_VEC: Record<SceneDir, THREE.Vector3> = {
  "+X": new THREE.Vector3(1, 0, 0), "-X": new THREE.Vector3(-1, 0, 0),
  "+Y": new THREE.Vector3(0, 1, 0), "-Y": new THREE.Vector3(0, -1, 0),
  "+Z": new THREE.Vector3(0, 0, 1), "-Z": new THREE.Vector3(0, 0, -1),
};

export const CABLE_RADIUS = 0.09;
/** Half a cell + a hair, so neighbouring cells' tube ends overlap instead of gapping. */
const REACH = 0.52;

// ponytail: cache keyed by the arm set — a circuit has hundreds of cells but only
// a dozen distinct shapes. Geometries are never disposed; the cache is process-wide
// and bounded by 6+15+20+15+6+1 = 63 entries.
const cache = new Map<string, THREE.BufferGeometry[]>();

/**
 * The meshes for one cable cell: a tube from the cell centre out to each arm.
 *
 * Exactly two arms (straight run or L-bend) become ONE tube swept along a
 * quadratic bezier between the arm tips with the cell centre as control point —
 * collinear arms give a straight rod, a perpendicular pair sweeps one full-cell
 * arc (the game's in-block L bend). Any other count (endpoint stub, tee, cross,
 * bridge ramp) gets one straight tube per arm plus a sphere at the centre to
 * fill the joint.
 */
export function cableGeoms(dirs: readonly SceneDir[]): THREE.BufferGeometry[] {
  const arms = [...new Set(dirs)];
  const key = [...arms].sort().join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  const at = (d: SceneDir, s: number) => SCENE_VEC[d].clone().multiplyScalar(s);
  let geoms: THREE.BufferGeometry[];
  if (arms.length === 2) {
    // Tangents at both ends run along the arm axes, so neighbouring cells'
    // tubes continue seamlessly into the arc.
    const [a, b] = arms;
    const curve = new THREE.QuadraticBezierCurve3(
      at(a, REACH), new THREE.Vector3(), at(b, REACH),
    );
    geoms = [new THREE.TubeGeometry(curve, 24, CABLE_RADIUS, 10, false)];
  } else {
    geoms = arms.map((d) =>
      new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(), at(d, REACH)),
        1, CABLE_RADIUS, 10, false,
      ),
    );
    geoms.push(new THREE.SphereGeometry(CABLE_RADIUS, 12, 12));
  }
  cache.set(key, geoms);
  return geoms;
}
