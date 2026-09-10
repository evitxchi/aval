/** Pure geometry shared by pointer handling and regression tests. */
export type PanelRect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
export function fitPanel(rect: PanelRect, viewport: Viewport, minimized = false): PanelRect {
  const availableW = Math.max(1, viewport.width - 16), availableH = Math.max(1, viewport.height - 16);
  const width = clamp(rect.width, Math.min(360, availableW), availableW);
  const height = minimized ? Math.min(64, availableH) : clamp(rect.height, Math.min(420, availableH), availableH);
  return { x: clamp(rect.x, 8, Math.max(8, viewport.width - width - 8)), y: clamp(rect.y, 8, Math.max(8, viewport.height - height - 8)), width, height };
}
export function dockPanel(rect: PanelRect, viewport: Viewport): PanelRect {
  const fit = fitPanel({ ...rect, y: 8, height: viewport.height - 16 }, viewport);
  return { ...fit, x: viewport.width - fit.width - 8 };
}
export function resizePanel(rect: PanelRect, edge: ResizeEdge, dx: number, dy: number, viewport: Viewport): PanelRect {
  const minW = Math.min(360, viewport.width - 16), minH = Math.min(420, viewport.height - 16);
  const left = edge.includes('w') ? clamp(rect.x + dx, 8, rect.x + rect.width - minW) : rect.x;
  const top = edge.includes('n') ? clamp(rect.y + dy, 8, rect.y + rect.height - minH) : rect.y;
  const right = edge.includes('e') ? clamp(rect.x + rect.width + dx, left + minW, viewport.width - 8) : rect.x + rect.width;
  const bottom = edge.includes('s') ? clamp(rect.y + rect.height + dy, top + minH, viewport.height - 8) : rect.y + rect.height;
  return fitPanel({ x: left, y: top, width: right - left, height: bottom - top }, viewport);
}
export function dragDestination(x: number, y: number, viewport: Viewport): 'window' | 'dock' | 'float' {
  if (x < -16 || x > viewport.width + 16 || y < -16 || y > viewport.height + 16) return 'window';
  return x >= viewport.width - 48 ? 'dock' : 'float';
}
