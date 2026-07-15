import { describe, it, expect } from "vitest";
import {
  routeCables,
  type UiRect,
  type RouteRequest,
  type UiPoint,
} from "../layout/uiRoute";

/** True if the polyline is orthogonal (each segment is axis-aligned). */
function isOrthogonal(points: UiPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const horiz = Math.abs(a.y - b.y) < 1e-6;
    const vert = Math.abs(a.x - b.x) < 1e-6;
    if (!horiz && !vert) return false;
  }
  return true;
}

/** True if any segment passes under the body of a block (its true rectangle). */
function crossesBlock(points: UiPoint[], rects: UiRect[]): boolean {
  const E = 0.5;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const r of rects) {
      const left = r.x;
      const right = r.x + r.w;
      const top = r.y;
      const bottom = r.y + r.h;
      if (Math.abs(a.y - b.y) < 1e-6) {
        const y = a.y;
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        if (top + E < y && y < bottom - E && left + E < hi && lo < right - E) return true;
      } else {
        const x = a.x;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (left + E < x && x < right - E && top + E < hi && lo < bottom - E) return true;
      }
    }
  }
  return false;
}

describe("routeCables", () => {
  it("connects a simple two-block edge to the exact port anchors", () => {
    const blocks: UiRect[] = [
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 200, y: 0, w: 100, h: 40 },
    ];
    const from: UiPoint = { x: 100, y: 20 };
    const to: UiPoint = { x: 200, y: 20 };
    const req: RouteRequest = { id: "e1", from, to };

    const [routed] = routeCables(blocks, [req]);
    expect(routed.points[0]).toEqual(from);
    expect(routed.points[routed.points.length - 1]).toEqual(to);
    expect(isOrthogonal(routed.points)).toBe(true);
  });

  it("never runs a cable through the interior of a block", () => {
    // Target sits behind an obstacle block that would be crossed by a straight run.
    const blocks: UiRect[] = [
      { x: 0, y: 0, w: 100, h: 40 }, // source
      { x: 200, y: 0, w: 100, h: 200 }, // tall obstacle in the middle column
      { x: 400, y: 300, w: 100, h: 40 }, // target far below
    ];
    const req: RouteRequest = {
      id: "e1",
      from: { x: 100, y: 20 },
      to: { x: 400, y: 320 },
    };
    const [routed] = routeCables(blocks, [req]);
    expect(crossesBlock(routed.points, blocks)).toBe(false);
    expect(isOrthogonal(routed.points)).toBe(true);
  });

  it("spreads parallel cables so they do not fully overlap", () => {
    // Two edges from the same column to the same column, different rows.
    const blocks: UiRect[] = [
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 0, y: 80, w: 100, h: 40 },
      { x: 200, y: 0, w: 100, h: 40 },
      { x: 200, y: 80, w: 100, h: 40 },
    ];
    const requests: RouteRequest[] = [
      { id: "a", from: { x: 100, y: 20 }, to: { x: 200, y: 100 } },
      { id: "b", from: { x: 100, y: 100 }, to: { x: 200, y: 20 } },
    ];
    const routed = routeCables(blocks, requests);
    // Collect the vertical-segment x positions used by each cable.
    const verticalXs = (pts: UiPoint[]): Set<number> => {
      const s = new Set<number>();
      for (let i = 1; i < pts.length; i++) {
        if (Math.abs(pts[i].x - pts[i - 1].x) < 1e-6) s.add(Math.round(pts[i].x));
      }
      return s;
    };
    const xa = verticalXs(routed[0].points);
    const xb = verticalXs(routed[1].points);
    // The two cables should not share every vertical lane.
    const shared = [...xa].filter((x) => xb.has(x));
    expect(shared.length).toBeLessThan(Math.max(xa.size, xb.size));
    for (const r of routed) expect(crossesBlock(r.points, blocks)).toBe(false);
  });
});
