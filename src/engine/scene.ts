import { Colors, type Color } from "./color";
import { IDENTITY, apply, invert, multiply, type Matrix, type Point, type Size } from "./geometry";
import { Node } from "./node";
import type { View } from "./view";

/** One finger / mouse pointer. `location` is in scene coordinates. */
export interface Touch {
  readonly id: number;
  location: Point;
}

/**
 * Scene (like SKScene): the root of a node tree, with an optional camera.
 * Scene coordinates have the origin at the bottom left and y up.
 */
export class Scene extends Node {
  backgroundColor: Color = Colors.black;
  view: View | null = null;

  /** Camera: the world point shown at the screen center. Its children stay on screen. */
  camera: Node | null = null;
  /** World units per screen point (like the camera's scale in SpriteKit) */
  cameraZoom = 1;

  constructor(public size: Size) {
    super();
  }

  /** Scene (world) space to screen space */
  get viewMatrix(): Matrix {
    if (!this.camera) return IDENTITY;
    const z = this.cameraZoom;
    const p = this.camera.position;
    return [1 / z, 0, 0, 1 / z, this.size.width / 2 - p.x / z, this.size.height / 2 - p.y / z];
  }

  /** Screen point to a node's local space */
  screenToNode(point: Point, node: Node): Point {
    const m = multiply(this.viewMatrix, node === this ? IDENTITY : node.worldMatrix);
    const inverse = invert(m);
    return inverse ? apply(inverse, point) : point;
  }

  /** Screen point to world (scene) coordinates */
  screenToWorld(point: Point): Point {
    return this.screenToNode(point, this);
  }

  // Lifecycle
  didMove(_view: View): void {}
  willMove(_view: View): void {}
  update(_currentTime: number): void {}

  // Input (touch locations are in screen space: scene points with the origin at the bottom left)
  touchesBegan(_touches: Touch[]): void {}
  touchesMoved(_touches: Touch[]): void {}
  touchesEnded(_touches: Touch[]): void {}
  touchesCancelled(touches: Touch[]): void {
    this.touchesEnded(touches);
  }
  /** Key pressed (KeyboardEvent.code). Return true to block the browser's default action. */
  keyDown(_code: string, _repeat: boolean): boolean {
    return false;
  }
  keyUp(_code: string): void {}
  /** The page lost focus or was hidden */
  willResignActive(): void {}
}
