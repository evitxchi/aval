/**
 * Shape geometry for AvalAgentAvatar, kept deliberately separate from
 * lighting/color (themes.ts). Each shape is a plain descriptor — never
 * pre-colored JSX — so AgentAvatar.tsx can render the same geometry three
 * different ways: as a white silhouette (an SVG <mask>, defining where
 * lighting is visible), as a blurred colored halo sitting behind the
 * silhouette (bloom), and as a thin colored outline just inside the
 * silhouette's edge (rim light). See geometry-to-jsx.tsx for the renderer.
 *
 * Straight-edged, simple silhouettes on purpose — legible at 24px, where
 * fine curve detail disappears. Dimension comes from AgentAvatar's
 * lighting, not the geometry. `fourPoint` deliberately avoids a symmetric
 * sparkle/star silhouette (explicitly out of scope per the design brief)
 * by elongating and offsetting its arms.
 */

export type ShapeId = "arch" | "shard" | "portal" | "fourPoint" | "monolith" | "planes";

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type ShapePrimitive =
  | { kind: "path"; d: string }
  | { kind: "polygon"; points: string }
  | { kind: "rect"; x: number; y: number; width: number; height: number; rx: number }
  | { kind: "ring"; cx: number; cy: number; r: number; arcFraction: number; rotationDeg: number }
  | { kind: "compound"; parts: ShapePrimitive[] };

export type ShapeGeometry = ShapePrimitive & { bbox: BoundingBox };

// Every shape spans close to the full 0-100 canvas (matching fourPoint's
// natural scale) — the container's own padding (globals.css) is what
// supplies the brief's 15-20% breathing room, so the geometry itself
// shouldn't add a second margin on top of it. `bbox` drives where
// AgentAvatar.tsx centers each light source: without it, a fixed light
// position (tuned for one shape's silhouette) falls outside a narrower
// shape's bounds and reads as flat/dim instead of lit.
export const SHAPES: Record<ShapeId, ShapeGeometry> = {
  arch: { kind: "path", d: "M24,94 L24,52 A26,26 0 0 1 76,52 L76,94 Z", bbox: { x0: 24, y0: 26, x1: 76, y1: 94 } },
  shard: { kind: "path", d: "M36,6 L64,6 L78,50 L60,94 L40,94 L28,52 Z", bbox: { x0: 28, y0: 6, x1: 78, y1: 94 } },
  portal: { kind: "ring", cx: 50, cy: 50, r: 32, arcFraction: 0.74, rotationDeg: -125, bbox: { x0: 7, y0: 7, x1: 93, y1: 93 } },
  fourPoint: { kind: "polygon", points: "52,6 66,34 94,46 64,58 56,92 38,62 14,54 40,36", bbox: { x0: 14, y0: 6, x1: 94, y1: 92 } },
  monolith: { kind: "rect", x: 24, y: 6, width: 52, height: 88, rx: 16, bbox: { x0: 24, y0: 6, x1: 76, y1: 94 } },
  planes: {
    kind: "compound",
    parts: [
      { kind: "path", d: "M10,34 L80,14 L94,42 L26,64 Z" },
      { kind: "path", d: "M18,58 L86,38 L98,70 L30,90 Z" },
      // A zero-area line between the two facets' facing edges — fill-based
      // silhouette/bloom passes render it as nothing (a line has no area),
      // but the rim pass strokes it, giving "intersecting planes" a visible
      // seam instead of reading as one blob at small sizes.
      { kind: "path", d: "M20,60 L90,40" },
    ],
    bbox: { x0: 10, y0: 14, x1: 98, y1: 90 },
  },
};

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];
