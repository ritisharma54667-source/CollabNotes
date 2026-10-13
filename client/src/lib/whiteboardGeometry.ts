/** Fixed logical board size; the canvas is scaled to fit, so strokes line up on every screen. */
export const BOARD_W = 1600;
export const BOARD_H = 1000;

export interface Stroke {
  id: string;
  color: string;
  width: number;
  /** Flat [x0, y0, x1, y1, …] in board coordinates. */
  points: number[];
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const p = stroke.points;
  const reach = radius + stroke.width / 2;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Pick<Stroke, 'color' | 'width' | 'points'>) {
  const p = s.points;
  if (p.length < 2) return;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
