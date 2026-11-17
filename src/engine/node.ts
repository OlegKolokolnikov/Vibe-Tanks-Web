import { Action, type ActionRun } from "./actions";
import { Colors, css, type Color } from "./color";
import { IDENTITY, apply, invert, multiply, nodeMatrix, type Matrix, type Point, type Rect, type Size } from "./geometry";
import { Path } from "./path";

/** Texture: any drawable image (an offscreen canvas made with makeTexture) */
export type Texture = HTMLCanvasElement;

/**
 * Scene graph node (like SKNode). Y points up. zPosition adds up through the tree and
 * decides draw order across the whole scene (siblings with equal z draw in tree order).
 */
export class Node {
  position: Point = { x: 0, y: 0 };
  zRotation = 0;
  xScale = 1;
  yScale = 1;
  alpha = 1;
  isHidden = false;
  zPosition = 0;
  name: string | null = null;
  /** Actions on this node and its children stop while paused */
  isPaused = false;
  /** Tint (colorize action); drawn by sprites */
  blendColor: Color = Colors.white;
  colorBlendFactor = 0;
  /** "lighter" = additive blending */
  blendMode: GlobalCompositeOperation = "source-over";

  readonly children: Node[] = [];
  parent: Node | null = null;
  private actions: { run: ActionRun; key?: string }[] = [];

  addChild(child: Node): void {
    if (child.parent) child.removeFromParent();
    child.parent = this;
    this.children.push(child);
  }

  removeFromParent(): void {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = null;
  }

  removeAllChildren(): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  setScale(scale: number): void {
    this.xScale = scale;
    this.yScale = scale;
  }

  /** Child with this name; "//name" searches the whole subtree */
  childNode(name: string): Node | null {
    if (name.startsWith("//")) {
      const wanted = name.slice(2);
      const stack: Node[] = [...this.children];
      while (stack.length) {
        const node = stack.shift()!;
        if (node.name === wanted) return node;
        stack.push(...node.children);
      }
      return null;
    }
    return this.children.find((c) => c.name === name) ?? null;
  }

  run(action: Action, key?: string): void {
    if (key !== undefined) this.removeAction(key);
    this.actions.push({ run: action.start(this), key });
  }

  removeAction(key: string): void {
    this.actions = this.actions.filter((a) => a.key !== key);
  }

  removeAllActions(): void {
    this.actions = [];
  }

  hasActions(): boolean {
    return this.actions.length > 0;
  }

  /** Advance actions on this node and its subtree */
  updateActions(dt: number): void {
    if (this.isPaused) return;
    if (this.actions.length) {
      const running = this.actions.slice();
      for (const entry of running) {
        if (!this.actions.includes(entry)) continue; // Removed by another action
        if (entry.run.step(dt) >= 0) {
          const index = this.actions.indexOf(entry);
          if (index >= 0) this.actions.splice(index, 1);
        }
      }
    }
    if (this.children.length) {
      for (const child of this.children.slice()) {
        if (child.parent === this) child.updateActions(dt);
      }
    }
  }

  get localMatrix(): Matrix {
    return nodeMatrix(this.position.x, this.position.y, this.zRotation, this.xScale, this.yScale);
  }

  /** Transform from this node's space to the scene root */
  get worldMatrix(): Matrix {
    let m = this.localMatrix;
    for (let p = this.parent; p; p = p.parent) m = multiply(p.localMatrix, m);
    return m;
  }

  /** Convert a point in `other`'s space into this node's space */
  convertPoint(point: Point, from: Node): Point {
    const inverse = invert(this.worldMatrix);
    if (!inverse) return point;
    return apply(inverse, apply(from.worldMatrix, point));
  }

  /** Own drawable bounds in local space (null = nothing to hit) */
  localBounds(): Rect | null {
    return null;
  }

  /** Draw in local space (y up). Only nodes that override this are drawn. */
  draw?(ctx: CanvasRenderingContext2D): void;

  /** Bounding box of this node and its children, in the parent's space (like calculateAccumulatedFrame) */
  accumulatedFrame(): Rect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const visit = (node: Node, m: Matrix) => {
      const b = node.localBounds();
      if (b) {
        for (const p of [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x, y: b.y + b.height },
          { x: b.x + b.width, y: b.y + b.height },
        ]) {
          const q = apply(m, p);
          minX = Math.min(minX, q.x);
          minY = Math.min(minY, q.y);
          maxX = Math.max(maxX, q.x);
          maxY = Math.max(maxY, q.y);
        }
      }
      for (const child of node.children) visit(child, multiply(m, child.localMatrix));
    };
    visit(this, this.localMatrix);
    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /** Descendants whose own bounds contain the point (given in this node's space), topmost first */
  nodesAt(point: Point): Node[] {
    const hits: { node: Node; z: number; order: number }[] = [];
    let order = 0;
    const visit = (node: Node, m: Matrix, z: number) => {
      if (node.isHidden) return;
      const b = node.localBounds();
      if (b) {
        const inverse = invert(m);
        if (inverse) {
          const p = apply(inverse, point);
          if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
            hits.push({ node, z, order: order++ });
          }
        }
      }
      for (const child of node.children) visit(child, multiply(m, child.localMatrix), z + child.zPosition);
    };
    for (const child of this.children) visit(child, child.localMatrix, child.zPosition);
    hits.sort((a, b) => b.z - a.z || b.order - a.order);
    return hits.map((h) => h.node);
  }
}

// MARK: - Shapes

export class ShapeNode extends Node {
  fillColor: Color = Colors.clear;
  strokeColor: Color = Colors.white;
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  glowWidth = 0;

  constructor(public path: Path | null = null) {
    super();
  }

  static rect(width: number, height: number, cornerRadius = 0): ShapeNode {
    return new ShapeNode(Path.rectCentered(width, height, cornerRadius));
  }

  /** Rect with its origin at (x, y), like SKShapeNode(rect:) */
  static rectAt(x: number, y: number, width: number, height: number, cornerRadius = 0): ShapeNode {
    const path = new Path();
    if (cornerRadius > 0) path.roundRect(x, y, width, height, cornerRadius);
    else path.rect(x, y, width, height);
    return new ShapeNode(path);
  }

  static circle(radius: number): ShapeNode {
    return new ShapeNode(Path.circle(radius));
  }

  static ellipse(width: number, height: number): ShapeNode {
    return new ShapeNode(Path.ellipse(width, height));
  }

  localBounds(): Rect | null {
    return this.path ? this.path.bounds : null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.path) return;
    if (this.fillColor.a > 0) {
      ctx.fillStyle = css(this.fillColor);
      ctx.fill(this.path.path2d);
    }
    if (this.strokeColor.a > 0 && this.lineWidth > 0) {
      ctx.strokeStyle = css(this.strokeColor);
      ctx.lineWidth = this.lineWidth;
      ctx.lineCap = this.lineCap;
      ctx.lineJoin = "round";
      ctx.stroke(this.path.path2d);
    }
  }
}

// MARK: - Labels

export type HAlign = "center" | "left" | "right";
export type VAlign = "baseline" | "center" | "top" | "bottom";

const FONT_STACK = 'Helvetica, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function cssFont(fontName: string | null, fontSize: number): string {
  const name = fontName ?? "";
  const weight = /bold/i.test(name) ? "bold" : name ? "normal" : "300";
  return `${weight} ${fontSize}px ${FONT_STACK}`;
}

let measureContext: CanvasRenderingContext2D | null = null;

export function measureText(text: string, font: string): number {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d")!;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

export class LabelNode extends Node {
  fontName: string | null = null;
  fontSize = 32;
  fontColor: Color = Colors.white;
  horizontalAlignmentMode: HAlign = "center";
  verticalAlignmentMode: VAlign = "baseline";

  constructor(
    public text = "",
    fontName?: string,
  ) {
    super();
    if (fontName) this.fontName = fontName;
  }

  get font(): string {
    return cssFont(this.fontName, this.fontSize);
  }

  /** Text box in local space */
  localBounds(): Rect | null {
    if (!this.text) return null;
    const width = measureText(this.text, this.font);
    const height = this.fontSize;
    const x = this.horizontalAlignmentMode === "left" ? 0 : this.horizontalAlignmentMode === "right" ? -width : -width / 2;
    let y: number;
    switch (this.verticalAlignmentMode) {
      case "center":
        y = -height / 2;
        break;
      case "top":
        y = -height;
        break;
      case "bottom":
        y = 0;
        break;
      default:
        y = -height * 0.22;
    }
    return { x, y, width, height };
  }

  /** Frame in the parent's space */
  get frame(): Rect {
    const b = this.localBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    return { x: this.position.x + b.x * this.xScale, y: this.position.y + b.y * this.yScale, width: b.width * this.xScale, height: b.height * this.yScale };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.text) return;
    ctx.font = this.font;
    ctx.fillStyle = css(this.fontColor);
    ctx.textAlign = this.horizontalAlignmentMode;
    ctx.textBaseline =
      this.verticalAlignmentMode === "center"
        ? "middle"
        : this.verticalAlignmentMode === "top"
          ? "top"
          : this.verticalAlignmentMode === "bottom"
            ? "bottom"
            : "alphabetic";
    ctx.scale(1, -1); // Text reads upright in the y-up world
    ctx.fillText(this.text, 0, 0);
  }
}

// MARK: - Sprites

let tintCanvas: HTMLCanvasElement | null = null;

export class SpriteNode extends Node {
  anchorPoint: Point = { x: 0.5, y: 0.5 };
  size: Size;

  constructor(
    public texture: Texture | null,
    public color: Color = Colors.white,
    size?: Size,
  ) {
    super();
    this.size = size ?? (texture ? { width: texture.width / TEXTURE_SCALE, height: texture.height / TEXTURE_SCALE } : { width: 0, height: 0 });
  }

  localBounds(): Rect | null {
    return {
      x: -this.anchorPoint.x * this.size.width,
      y: -this.anchorPoint.y * this.size.height,
      width: this.size.width,
      height: this.size.height,
    };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.size;
    if (width <= 0 || height <= 0) return;
    const x = -this.anchorPoint.x * width;
    const y = -this.anchorPoint.y * height;
    if (!this.texture) {
      const c = this.color;
      const t = this.colorBlendFactor;
      const b = this.blendColor;
      ctx.fillStyle = css(t > 0 ? { r: c.r + (b.r - c.r) * t, g: c.g + (b.g - c.g) * t, b: c.b + (b.b - c.b) * t, a: c.a } : c);
      ctx.fillRect(x, y, width, height);
      return;
    }
    let image: CanvasImageSource = this.texture;
    if (this.colorBlendFactor > 0.001) {
      if (!tintCanvas) tintCanvas = document.createElement("canvas");
      const tw = this.texture.width;
      const th = this.texture.height;
      if (tintCanvas.width < tw || tintCanvas.height < th) {
        tintCanvas.width = Math.max(tintCanvas.width, tw);
        tintCanvas.height = Math.max(tintCanvas.height, th);
      }
      const tctx = tintCanvas.getContext("2d")!;
      tctx.globalCompositeOperation = "copy";
      tctx.drawImage(this.texture, 0, 0);
      tctx.globalCompositeOperation = "source-atop";
      tctx.fillStyle = css({ ...this.blendColor, a: Math.min(this.colorBlendFactor, 1) });
      tctx.fillRect(0, 0, tw, th);
      tctx.globalCompositeOperation = "source-over";
      ctx.scale(1, -1);
      ctx.drawImage(tintCanvas, 0, 0, tw, th, x, -y - height, width, height);
      return;
    }
    // Textures are stored top row first: flip back for the y-up world
    ctx.scale(1, -1);
    ctx.drawImage(image, x, -y - height, width, height);
  }
}

/** Node drawn by a callback (local space, y up) */
export class CustomNode extends Node {
  constructor(
    public drawFn: (ctx: CanvasRenderingContext2D) => void,
    public bounds: Rect | null = null,
  ) {
    super();
  }

  localBounds(): Rect | null {
    return this.bounds;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawFn(ctx);
  }
}

// MARK: - Rendering

/** Pixels per point in generated textures (sharp when zoomed in on big or high-DPI screens) */
export const TEXTURE_SCALE = 4;

/**
 * Offscreen texture of `width` x `height` points. The callback draws in points with the
 * origin at the top left and y down (like UIGraphicsImageRenderer).
 */
export function makeTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * TEXTURE_SCALE));
  canvas.height = Math.max(1, Math.ceil(height * TEXTURE_SCALE));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  draw(ctx);
  return canvas;
}

/** Render a node tree into a texture, with the node's origin at the texture center (y up) */
export function renderNodeToTexture(node: Node, width: number, height: number): Texture {
  return makeTexture(width, height, (ctx) => {
    const base: Matrix = [TEXTURE_SCALE, 0, 0, -TEXTURE_SCALE, (width / 2) * TEXTURE_SCALE, (height / 2) * TEXTURE_SCALE];
    renderTree(ctx, [node], base);
  });
}

interface DrawItem {
  node: Node;
  matrix: Matrix;
  alpha: number;
  z: number;
  order: number;
}

const drawList: DrawItem[] = [];

/** Draw nodes (and their subtrees) sorted by global z. `base` maps node space to canvas pixels. */
export function renderTree(ctx: CanvasRenderingContext2D, roots: Node[], base: Matrix = IDENTITY): void {
  drawList.length = 0;
  let order = 0;
  const visit = (node: Node, parent: Matrix, parentAlpha: number, parentZ: number) => {
    if (node.isHidden) return;
    const alpha = parentAlpha * node.alpha;
    if (alpha <= 0.001) return;
    const matrix = multiply(parent, node.localMatrix);
    const z = parentZ + node.zPosition;
    if (node.draw) drawList.push({ node, matrix, alpha, z, order: order++ });
    for (const child of node.children) visit(child, matrix, alpha, z);
  };
  for (const root of roots) visit(root, base, 1, 0);
  drawList.sort((a, b) => a.z - b.z || a.order - b.order);
  for (const item of drawList) {
    const m = item.matrix;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = Math.min(item.alpha, 1);
    const blend = item.node.blendMode;
    if (blend !== "source-over") ctx.globalCompositeOperation = blend;
    item.node.draw!(ctx);
    if (blend !== "source-over") ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = 1;
  drawList.length = 0;
}
