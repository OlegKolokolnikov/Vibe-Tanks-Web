import type { Point, Rect } from "./geometry";

/**
 * Vector path (like CGMutablePath) that also tracks its bounding box, so shapes built
 * from it can be hit-tested. Coordinates are in the shape's local space.
 */
export class Path {
  readonly path2d = new Path2D();
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private cx = 0;
  private cy = 0;

  private include(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  get bounds(): Rect {
    if (this.minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: this.minX, y: this.minY, width: this.maxX - this.minX, height: this.maxY - this.minY };
  }

  get currentPoint(): Point {
    return { x: this.cx, y: this.cy };
  }

  moveTo(x: number, y: number): this {
    this.path2d.moveTo(x, y);
    this.include(x, y);
    this.cx = x;
    this.cy = y;
    return this;
  }

  lineTo(x: number, y: number): this {
    this.path2d.lineTo(x, y);
    this.include(x, y);
    this.cx = x;
    this.cy = y;
    return this;
  }

  quadTo(cpx: number, cpy: number, x: number, y: number): this {
    this.path2d.quadraticCurveTo(cpx, cpy, x, y);
    this.include(cpx, cpy);
    this.include(x, y);
    this.cx = x;
    this.cy = y;
    return this;
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.path2d.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    this.include(c1x, c1y);
    this.include(c2x, c2y);
    this.include(x, y);
    this.cx = x;
    this.cy = y;
    return this;
  }

  /** Arc; `clockwise` false means the angle increases (same as CGPath addArc) */
  arc(x: number, y: number, r: number, start: number, end: number, clockwise = false): this {
    this.path2d.arc(x, y, r, start, end, clockwise);
    this.include(x - r, y - r);
    this.include(x + r, y + r);
    this.cx = x + Math.cos(end) * r;
    this.cy = y + Math.sin(end) * r;
    return this;
  }

  close(): this {
    this.path2d.closePath();
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.path2d.rect(x, y, w, h);
    this.include(x, y);
    this.include(x + w, y + h);
    return this;
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): this {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    this.path2d.roundRect(x, y, w, h, radius);
    this.include(x, y);
    this.include(x + w, y + h);
    return this;
  }

  /** Ellipse inscribed in a rect */
  ellipseIn(x: number, y: number, w: number, h: number): this {
    this.path2d.moveTo(x + w, y + h / 2);
    this.path2d.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    this.include(x, y);
    this.include(x + w, y + h);
    return this;
  }

  static rectCentered(w: number, h: number, cornerRadius = 0): Path {
    const p = new Path();
    return cornerRadius > 0 ? p.roundRect(-w / 2, -h / 2, w, h, cornerRadius) : p.rect(-w / 2, -h / 2, w, h);
  }

  static ellipse(w: number, h: number): Path {
    return new Path().ellipseIn(-w / 2, -h / 2, w, h);
  }

  static circle(r: number): Path {
    return Path.ellipse(r * 2, r * 2);
  }
}
