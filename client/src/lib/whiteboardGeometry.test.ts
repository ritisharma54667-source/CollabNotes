import { describe, expect, it } from 'vitest';
import { distToSegment, strokeHit, type Stroke } from './whiteboardGeometry';

const stroke = (points: number[], width = 4): Stroke => ({ id: 's', color: '#000', width, points });

describe('distToSegment', () => {
  it('measures distance to the segment, not the infinite line', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBe(5); // beyond the start → distance to endpoint
    expect(distToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2); // degenerate segment
  });
});

describe('strokeHit', () => {
  it('hits near any segment of a stroke', () => {
    const s = stroke([0, 0, 100, 0, 100, 100]);
    expect(strokeHit(s, 50, 5, 10)).toBe(true);
    expect(strokeHit(s, 105, 50, 10)).toBe(true);
    expect(strokeHit(s, 50, 50, 10)).toBe(false);
  });
  it('supports single-point strokes (a dot)', () => {
    expect(strokeHit(stroke([10, 10]), 12, 10, 5)).toBe(true);
    expect(strokeHit(stroke([10, 10]), 40, 10, 5)).toBe(false);
  });
});
