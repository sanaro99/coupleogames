import { describe, expect, it } from 'vitest';
import { resolvePerch } from '../src/components/catLayout';

describe('cat landing positions', () => {
  it('keeps a cat on screen when the anchor is scrolled above the viewport', () => {
    const p = resolvePerch({ x: 20, y: -250, width: 150, height: 200 }, { width: 390, height: 844 }, []);
    expect(p.x).toBeGreaterThanOrEqual(48); expect(p.x).toBeLessThanOrEqual(342);
    expect(p.y).toBeGreaterThanOrEqual(96); expect(p.y).toBeLessThanOrEqual(828); expect(p.hidden).toBe(false);
  });
  it('moves off a landing position that overlaps a game input', () => {
    const p = resolvePerch({ x: 20, y: 180, width: 350, height: 300 }, { width: 390, height: 844 }, [{ x: 240, y: 120, width: 150, height: 180 }]);
    const overlaps = p.x + 42 > 240 && p.x - 42 < 390 && p.y > 120 && p.y - 86 < 300;
    expect(overlaps).toBe(false); expect(p.hidden).toBe(false);
  });
  it('hides decorative geometry when a keyboard leaves no safe area', () => {
    const p = resolvePerch(undefined, { width: 320, height: 200 }, [{ x: 0, y: 0, width: 320, height: 200 }]);
    expect(p.hidden).toBe(true);
  });
});
