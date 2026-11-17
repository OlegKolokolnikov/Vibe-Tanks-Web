import { css, type Color } from "./color";

/** Small helpers mirroring CGContext calls used by the texture painters */

export function fill(ctx: CanvasRenderingContext2D, color: Color | string): void {
  ctx.fillStyle = typeof color === "string" ? color : css(color);
}

export function stroke(ctx: CanvasRenderingContext2D, color: Color | string, width?: number): void {
  ctx.strokeStyle = typeof color === "string" ? color : css(color);
  if (width !== undefined) ctx.lineWidth = width;
}

export function fillEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function strokeEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Stroke a list of separate line segments [x1, y1, x2, y2] in one path */
export function strokeLines(ctx: CanvasRenderingContext2D, segments: number[][]): void {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

/** Fill a closed polygon */
export function fillPolygon(ctx: CanvasRenderingContext2D, points: number[][]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/** Flip a texture context so y goes up (origin bottom left), like the Swift painters do */
export function flipY(ctx: CanvasRenderingContext2D, height: number): void {
  ctx.translate(0, height);
  ctx.scale(1, -1);
}
