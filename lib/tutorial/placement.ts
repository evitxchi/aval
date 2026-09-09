type Rect = { left: number; top: number; width: number; height: number };

/** Keep the pointer tip on the highlighted edge and the card beyond its tail. */
export function tourPlacement(anchor: Rect, viewport: { width: number; height: number }, cardHeight: number) {
  const margin = 16;
  const gap = 48;
  const width = Math.min(370, viewport.width - margin * 2);
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  const clamp = (value: number, max: number) => Math.max(margin, Math.min(value, max));
  const top = clamp(anchor.top - 10, viewport.height - cardHeight - margin);
  if (right + gap + width <= viewport.width - margin) {
    return { card: { left: right + gap, top, width }, pointer: { left: right + 4, top: anchor.top + anchor.height / 2 - 14, direction: 'left' } };
  }
  if (anchor.left - gap - width >= margin) {
    return { card: { left: anchor.left - gap - width, top, width }, pointer: { left: anchor.left - 32, top: anchor.top + anchor.height / 2 - 14, direction: 'right' } };
  }
  const below = viewport.height - bottom >= anchor.top;
  const available = Math.max(0, (below ? viewport.height - bottom : anchor.top) - gap - margin);
  return {
    card: { left: clamp(anchor.left, viewport.width - width - margin), top: below ? bottom + gap : Math.max(margin, anchor.top - gap - cardHeight), width, maxHeight: available },
    pointer: { left: anchor.left + anchor.width / 2 - 14, top: below ? bottom + 4 : anchor.top - 32, direction: below ? 'up' : 'down' },
  };
}
