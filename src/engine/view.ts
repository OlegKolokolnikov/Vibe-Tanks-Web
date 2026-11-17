import { css } from "./color";
import { multiply, type Matrix, type Point, type Size } from "./geometry";
import { renderTree } from "./node";
import type { Scene, Touch } from "./scene";

const STEP = 1 / 60;

/**
 * Hosts scenes on a canvas (like SKView): fixed 60 Hz updates, aspect-fit scaling,
 * fade transitions, and pointer / keyboard input forwarded to the current scene.
 */
export class View {
  scene: Scene | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private accumulator = 0;
  private lastTime = 0;
  private gameTime = 0;
  private transition: { next: Scene; duration: number; elapsed: number; switched: boolean } | null = null;
  private readonly activePointers = new Map<number, Touch>();
  /** Called after every rendered frame (for HTML overlays) */
  onFrame: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.setupInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Size for new scenes: the window in CSS pixels, scaled up on very small screens */
  get preferredSceneSize(): Size {
    const w = Math.max(window.innerWidth, 1);
    const h = Math.max(window.innerHeight, 1);
    const k = Math.max(1, 640 / w, 360 / h);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  }

  present(scene: Scene, fadeDuration = 0): void {
    if (!this.scene || fadeDuration <= 0) {
      this.switchTo(scene);
      return;
    }
    this.transition = { next: scene, duration: fadeDuration, elapsed: 0, switched: false };
  }

  private switchTo(scene: Scene): void {
    if (this.scene) {
      this.scene.willMove(this);
      this.scene.view = null;
    }
    this.cancelAllPointers();
    this.scene = scene;
    scene.view = this;
    scene.didMove(this);
  }

  // MARK: Layout

  /** Aspect-fit placement of the scene in the canvas, in CSS pixels */
  private get layout(): { fit: number; offsetX: number; offsetY: number } {
    const scene = this.scene!;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const fit = Math.min(w / scene.size.width, h / scene.size.height);
    return { fit, offsetX: (w - scene.size.width * fit) / 2, offsetY: (h - scene.size.height * fit) / 2 };
  }

  /** Visible scene rect top in scene points (letterbox aware) */
  get letterboxTop(): number {
    return this.layout.offsetY / this.layout.fit;
  }

  private resizeCanvas(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return dpr;
  }

  // MARK: Loop

  private frame(time: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const elapsed = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.25) : STEP;
    this.lastTime = time;

    if (this.transition) {
      const tr = this.transition;
      tr.elapsed += elapsed;
      if (!tr.switched && tr.elapsed >= tr.duration / 2) {
        tr.switched = true;
        this.switchTo(tr.next);
      }
      if (tr.elapsed >= tr.duration) this.transition = null;
    } else if (this.scene) {
      this.accumulator += elapsed;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this.gameTime += STEP;
        this.scene.update(this.gameTime);
        this.scene?.updateActions(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
    }

    this.render();
    this.onFrame?.();
  }

  private render(): void {
    const dpr = this.resizeCanvas();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scene = this.scene;
    if (!scene) return;

    const { fit, offsetX, offsetY } = this.layout;
    const base: Matrix = [dpr * fit, 0, 0, -dpr * fit, dpr * offsetX, dpr * (offsetY + scene.size.height * fit)];

    // Scene background inside the letterbox, then the tree
    ctx.fillStyle = css(scene.backgroundColor);
    ctx.fillRect(dpr * offsetX, dpr * offsetY, dpr * scene.size.width * fit, dpr * scene.size.height * fit);
    renderTree(ctx, scene.children, multiply(base, scene.viewMatrix));

    if (this.transition) {
      const tr = this.transition;
      const half = tr.duration / 2;
      const a = tr.elapsed < half ? tr.elapsed / half : 1 - (tr.elapsed - half) / half;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(Math.max(a, 0), 1);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  // MARK: Input

  /** Client (CSS pixel) point to scene screen point (origin bottom left, y up) */
  private toScene(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const { fit, offsetX, offsetY } = this.layout;
    const x = (clientX - rect.left - offsetX) / fit;
    const y = this.scene!.size.height - (clientY - rect.top - offsetY) / fit;
    return { x, y };
  }

  private cancelAllPointers(): void {
    if (this.activePointers.size && this.scene) {
      this.scene.touchesCancelled([...this.activePointers.values()]);
    }
    this.activePointers.clear();
  }

  private setupInput(): void {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.scene || this.transition) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      const touch: Touch = { id: e.pointerId, location: this.toScene(e.clientX, e.clientY) };
      this.activePointers.set(e.pointerId, touch);
      this.scene.touchesBegan([touch]);
    });
    canvas.addEventListener("pointermove", (e) => {
      const touch = this.activePointers.get(e.pointerId);
      if (!touch || !this.scene) return;
      e.preventDefault();
      touch.location = this.toScene(e.clientX, e.clientY);
      this.scene.touchesMoved([touch]);
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const touch = this.activePointers.get(e.pointerId);
      if (!touch) return;
      this.activePointers.delete(e.pointerId);
      if (!this.scene) return;
      touch.location = this.toScene(e.clientX, e.clientY);
      if (cancelled) this.scene.touchesCancelled([touch]);
      else this.scene.touchesEnded([touch]);
    };
    canvas.addEventListener("pointerup", (e) => end(e, false));
    canvas.addEventListener("pointercancel", (e) => end(e, true));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      if (!this.scene || e.metaKey || e.ctrlKey) return;
      if (this.scene.keyDown(e.code, e.repeat)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      this.scene?.keyUp(e.code);
    });

    const resign = () => {
      this.cancelAllPointers();
      this.scene?.willResignActive();
    };
    window.addEventListener("blur", resign);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) resign();
    });
  }
}
