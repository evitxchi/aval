import type { ReactElement } from "react";
import type { ShapePrimitive } from "./shapes";

export type ShapePaintMode = "silhouette" | "bloom" | "rim";

/**
 * Renders one ShapePrimitive as JSX for one of three paint modes, so a
 * single geometry descriptor drives the silhouette mask, the blurred
 * behind-the-shape bloom halo, and the thin inner-edge rim highlight —
 * see AgentAvatar.tsx for how the three are layered. Takes ShapePrimitive
 * (not the bbox-carrying ShapeGeometry) since bbox is only used by
 * AgentAvatar.tsx to position lighting, never by the geometry renderer.
 */
export function renderShapeLayer(geometry: ShapePrimitive, mode: ShapePaintMode, key?: string): ReactElement {
  if (geometry.kind === "compound") {
    return (
      <g key={key}>
        {geometry.parts.map((part, index) => renderShapeLayer(part, mode, `${key ?? "part"}-${index}`))}
      </g>
    );
  }

  if (geometry.kind === "ring") {
    // rim mode draws a slightly larger concentric ring, so its dash pattern
    // and offset are both computed from *its own* circumference — reusing
    // geometry.r's circumference for the offset would desync the gap's
    // rotation from where the dasharray actually draws it.
    const strokeWidth = mode === "rim" ? 3 : mode === "bloom" ? 22 : 20;
    const radius = mode === "rim" ? geometry.r + 8 : geometry.r;
    const circumference = 2 * Math.PI * radius;
    const arcLength = circumference * geometry.arcFraction;
    const dashOffset = -(geometry.rotationDeg / 360) * circumference;
    return (
      <circle
        key={key}
        cx={geometry.cx}
        cy={geometry.cy}
        r={radius}
        fill="none"
        stroke={mode === "silhouette" ? "#fff" : "currentColor"}
        strokeWidth={strokeWidth}
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        strokeDashoffset={dashOffset}
      />
    );
  }

  const fillPaint = mode === "rim" ? "none" : mode === "silhouette" ? "#fff" : "currentColor";
  const strokePaint = mode === "rim" ? "currentColor" : "none";
  const strokeWidth = mode === "rim" ? 2 : 0;

  if (geometry.kind === "path") {
    return <path key={key} d={geometry.d} fill={fillPaint} stroke={strokePaint} strokeWidth={strokeWidth} strokeLinejoin="round" />;
  }
  if (geometry.kind === "polygon") {
    return <polygon key={key} points={geometry.points} fill={fillPaint} stroke={strokePaint} strokeWidth={strokeWidth} strokeLinejoin="round" />;
  }
  return <rect key={key} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} rx={geometry.rx} fill={fillPaint} stroke={strokePaint} strokeWidth={strokeWidth} />;
}
