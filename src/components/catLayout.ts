export interface ScreenBox { x: number; y: number; width: number; height: number }
export interface CatPlacement { x: number; y: number; z: number; anchor: string; hidden: boolean }
export function resolvePerch(anchor: ScreenBox | undefined, viewport: { width: number; height: number }, obstacles: ScreenBox[]): CatPlacement {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const w = viewport.width; const h = viewport.height;
  const candidates = anchor ? [
    [anchor.x + anchor.width - 42, anchor.y + 35],
    [anchor.x - 50, anchor.y + 92],
    [anchor.x + anchor.width + 50, anchor.y + 92],
    [anchor.x + 48, anchor.y + anchor.height + 92],
  ] : [];
  candidates.push([w - 54, h - 24], [54, h - 24], [w - 54, 132], [54, 132]);
  // Include gaps between controls, including the smaller viewport above a keyboard.
  for (let y = 100; y < h - 12; y += 96) for (let x = 50; x < w - 40; x += 100) candidates.push([x, y]);
  for (const [cx, cy] of candidates) {
    const x = clamp(cx, 48, w - 48); const y = clamp(cy, 104, h - 16);
    const blocked = obstacles.some(r => x + 48 > r.x && x - 48 < r.x + r.width && y + 8 > r.y && y - 104 < r.y + r.height);
    if (!blocked && w >= 96 && h >= 112) return { x, y, z: 0, anchor: '', hidden: false };
  }
  return { x: Math.max(48, w - 54), y: Math.max(96, h - 24), z: 0, anchor: '', hidden: true };
}
