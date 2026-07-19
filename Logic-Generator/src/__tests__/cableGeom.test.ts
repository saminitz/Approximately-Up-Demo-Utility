import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { cableGeoms, CABLE_RADIUS, type SceneDir } from "../components/cableGeom";

/** Axis-aligned bounds of every tube/sphere in a cell, merged. */
function bounds(dirs: SceneDir[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const g of cableGeoms(dirs)) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  return box;
}

describe("cableGeoms", () => {
  it("draws a straight run as one tube spanning the whole cell", () => {
    const g = cableGeoms(["+X", "-X"]);
    expect(g).toHaveLength(1);
    const b = bounds(["+X", "-X"]);
    // Reaches past the ±0.5 cell boundary so neighbours meet, stays thin across.
    expect(b.min.x).toBeLessThanOrEqual(-0.5);
    expect(b.max.x).toBeGreaterThanOrEqual(0.5);
    expect(b.max.z).toBeCloseTo(CABLE_RADIUS, 2);
  });

  it("bends an L: both arms reach out, and the corner is rounded off", () => {
    const b = bounds(["+X", "+Z"]);
    expect(b.max.x).toBeGreaterThanOrEqual(0.5);
    expect(b.max.z).toBeGreaterThanOrEqual(0.5);
    // A square corner would push the outer face to +radius on both axes at once;
    // the elbow cuts inside that, so the far corner is empty.
    const corner = new THREE.Vector3(CABLE_RADIUS, 0, CABLE_RADIUS);
    const pos = cableGeoms(["+X", "+Z"])[0].getAttribute("position");
    let nearest = Infinity;
    for (let i = 0; i < pos.count; i++) {
      nearest = Math.min(nearest, corner.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i)));
    }
    expect(nearest).toBeGreaterThan(0.02);
  });

  it("gives a tee one tube per arm plus a joint sphere", () => {
    expect(cableGeoms(["+X", "-X", "+Z"])).toHaveLength(4);
  });

  it("treats a vertical bridge ramp arm like any other direction", () => {
    const b = bounds(["+X", "+Y"]);
    expect(b.max.y).toBeGreaterThanOrEqual(0.5);
  });

  it("caches by arm set, order-independent", () => {
    expect(cableGeoms(["+Z", "+X"])).toBe(cableGeoms(["+X", "+Z"]));
  });
});
