import { Colors, withAlpha, type Color } from "../engine/color";
import { distance, type Point, type Size } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Direction } from "./direction";
import { GameSettings, type FirePlacement } from "./settings";

/**
 * Single player: joystick and fire on opposite sides.
 * Two players: each player gets a joystick with a fire button next to it,
 * player 1 on the left edge, player 2 on the right edge.
 */
export type TouchLayout = "single" | "leftPlayer" | "rightPlayer";

const JOYSTICK_RADIUS = 80;
const KNOB_RADIUS = 35;
const FIRE_BUTTON_RADIUS = 65;
const PAUSE_BUTTON_SIZE = 50;

/** Virtual joystick and fire button for touch controls. Touch locations are in this node's space. */
export class TouchController extends Node {
  private readonly joystickBase: ShapeNode;
  private readonly joystickKnob: ShapeNode;
  private readonly fireButton: ShapeNode;
  private readonly pauseButton: ShapeNode;

  currentDirection: Direction | null = null;
  isFiring = false;
  pausePressed = false;
  private joystickTouch: number | null = null;
  private fireTouch: number | null = null;
  showsPauseButton = true;

  private _joystickPosition: Point = { x: 0, y: 0 };
  private _fireButtonPosition: Point = { x: 0, y: 0 };
  private _pauseButtonPosition: Point = { x: 0, y: 0 };

  get joystickPosition(): Point {
    return this._joystickPosition;
  }
  set joystickPosition(p: Point) {
    this._joystickPosition = { ...p };
    this.joystickBase.position = { ...p };
    this.joystickKnob.position = { ...p };
  }
  get fireButtonPosition(): Point {
    return this._fireButtonPosition;
  }
  set fireButtonPosition(p: Point) {
    this._fireButtonPosition = { ...p };
    this.fireButton.position = { ...p };
  }
  get pauseButtonPosition(): Point {
    return this._pauseButtonPosition;
  }
  set pauseButtonPosition(p: Point) {
    this._pauseButtonPosition = { ...p };
    this.pauseButton.position = { ...p };
  }

  constructor() {
    super();
    this.joystickBase = ShapeNode.circle(JOYSTICK_RADIUS);
    this.joystickBase.fillColor = withAlpha(Colors.gray, 0.3);
    this.joystickBase.strokeColor = withAlpha(Colors.white, 0.5);
    this.joystickBase.lineWidth = 2;
    this.joystickBase.zPosition = 100;

    this.joystickKnob = ShapeNode.circle(KNOB_RADIUS);
    this.joystickKnob.fillColor = withAlpha(Colors.white, 0.6);
    this.joystickKnob.strokeColor = Colors.white;
    this.joystickKnob.lineWidth = 2;
    this.joystickKnob.zPosition = 101;

    this.fireButton = ShapeNode.circle(FIRE_BUTTON_RADIUS);
    this.fireButton.fillColor = withAlpha(Colors.red, 0.5);
    this.fireButton.strokeColor = Colors.red;
    this.fireButton.lineWidth = 3;
    this.fireButton.zPosition = 100;
    const fireLabel = new LabelNode("FIRE", "Helvetica-Bold");
    fireLabel.fontSize = 20;
    fireLabel.fontColor = Colors.white;
    fireLabel.verticalAlignmentMode = "center";
    this.fireButton.addChild(fireLabel);

    this.pauseButton = ShapeNode.rect(PAUSE_BUTTON_SIZE, PAUSE_BUTTON_SIZE, 8);
    this.pauseButton.fillColor = withAlpha(Colors.gray, 0.4);
    this.pauseButton.strokeColor = withAlpha(Colors.white, 0.6);
    this.pauseButton.lineWidth = 2;
    this.pauseButton.zPosition = 250; // Above the pause overlay
    for (const x of [-5, 5]) {
      const bar = ShapeNode.rect(8, 24);
      bar.fillColor = Colors.white;
      bar.strokeColor = Colors.clear;
      bar.position = { x, y: 0 };
      this.pauseButton.addChild(bar);
    }

    this.addChild(this.joystickBase);
    this.addChild(this.joystickKnob);
    this.addChild(this.fireButton);
    this.addChild(this.pauseButton);
  }

  /** Lay out for a screen of `size` (coordinates relative to the camera center) */
  setupForScreen(size: Size, layout: TouchLayout = "single", firePlacement: FirePlacement = "above"): void {
    const sideMargin = 130;
    const bottomMargin = 100;
    const topMargin = 80;
    const gap = 230; // Two players: fire next to the joystick, touch zones don't overlap

    const leftX = -size.width / 2 + sideMargin;
    const rightX = size.width / 2 - sideMargin;
    const bottomY = -size.height / 2 + bottomMargin;

    this.pauseButtonPosition = { x: rightX, y: size.height / 2 - topMargin };

    const place = (edgeX: number, inward: number) => {
      const innerX = edgeX + inward * gap;
      const upperY = bottomY + gap;
      switch (firePlacement) {
        case "above":
          this.joystickPosition = { x: edgeX, y: bottomY };
          this.fireButtonPosition = { x: edgeX, y: upperY };
          break;
        case "below":
          this.joystickPosition = { x: edgeX, y: upperY };
          this.fireButtonPosition = { x: edgeX, y: bottomY };
          break;
        case "inside":
          this.joystickPosition = { x: edgeX, y: bottomY };
          this.fireButtonPosition = { x: innerX, y: bottomY };
          break;
        case "outside":
          this.joystickPosition = { x: innerX, y: bottomY };
          this.fireButtonPosition = { x: edgeX, y: bottomY };
          break;
      }
    };

    switch (layout) {
      case "leftPlayer":
        place(leftX, 1);
        this.setPauseButtonVisible(false); // The right player's controller owns pause
        return;
      case "rightPlayer":
        place(rightX, -1);
        this.setPauseButtonVisible(true);
        return;
      default:
        this.setPauseButtonVisible(true);
    }

    if (GameSettings.controlsSwapped) {
      this.fireButtonPosition = { x: leftX, y: bottomY };
      this.joystickPosition = { x: rightX, y: bottomY };
    } else {
      this.joystickPosition = { x: leftX, y: bottomY };
      this.fireButtonPosition = { x: rightX, y: bottomY };
    }
  }

  private setPauseButtonVisible(visible: boolean): void {
    this.showsPauseButton = visible;
    this.pauseButton.isHidden = !visible;
  }

  /** Tint the joystick ring with the player's tank color and label it ("1P" / "2P") */
  setPlayerMarker(text: string, color: Color): void {
    this.joystickBase.strokeColor = withAlpha(color, 0.8);
    this.joystickBase.lineWidth = 3;
    const label = new LabelNode(text, "Helvetica-Bold");
    label.fontSize = 22;
    label.fontColor = color;
    label.verticalAlignmentMode = "center";
    label.position = { x: 0, y: JOYSTICK_RADIUS + 42 };
    this.joystickBase.addChild(label);
  }

  setControlsScale(scale: number): void {
    for (const node of [this.joystickBase, this.joystickKnob, this.fireButton, this.pauseButton]) node.setScale(scale);
  }

  setGzhelMode(isGzhel: boolean): void {
    const barColor = isGzhel ? Colors.blue : Colors.white;
    for (const child of this.pauseButton.children) {
      if (child instanceof ShapeNode) child.fillColor = barColor;
    }
    this.pauseButton.strokeColor = isGzhel ? withAlpha(Colors.blue, 0.6) : withAlpha(Colors.white, 0.6);
  }

  // MARK: Touch handling (locations in this node's space)

  /** Returns true when the touch landed on a control */
  touchBegan(id: number, location: Point): boolean {
    if (this.showsPauseButton && distance(location, this._pauseButtonPosition) < PAUSE_BUTTON_SIZE) {
      this.pausePressed = true;
      this.pauseButton.fillColor = withAlpha(Colors.white, 0.6);
      return true;
    }
    if (this.joystickTouch === null && distance(location, this._joystickPosition) < JOYSTICK_RADIUS * 1.5) {
      this.joystickTouch = id;
      this.updateJoystick(location);
      return true;
    }
    if (this.fireTouch === null && distance(location, this._fireButtonPosition) < FIRE_BUTTON_RADIUS * 1.5) {
      this.fireTouch = id;
      this.isFiring = true;
      this.fireButton.fillColor = withAlpha(Colors.red, 0.8);
      return true;
    }
    return false;
  }

  touchMoved(id: number, location: Point): void {
    if (id === this.joystickTouch) this.updateJoystick(location);
  }

  touchEnded(id: number): void {
    if (id === this.joystickTouch) {
      this.joystickTouch = null;
      this.resetJoystick();
    }
    if (id === this.fireTouch) {
      this.fireTouch = null;
      this.isFiring = false;
      this.fireButton.fillColor = withAlpha(Colors.red, 0.5);
    }
    this.pauseButton.fillColor = withAlpha(Colors.gray, 0.4);
  }

  /** Release everything (lost focus, pause) */
  releaseAll(): void {
    if (this.joystickTouch !== null) this.touchEnded(this.joystickTouch);
    if (this.fireTouch !== null) this.touchEnded(this.fireTouch);
  }

  resetPausePressed(): void {
    this.pausePressed = false;
  }

  private updateJoystick(location: Point): void {
    const dx = location.x - this._joystickPosition.x;
    const dy = location.y - this._joystickPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, JOYSTICK_RADIUS);
    const angle = Math.atan2(dy, dx);
    this.joystickKnob.position = { x: this._joystickPosition.x + Math.cos(angle) * clamped, y: this._joystickPosition.y + Math.sin(angle) * clamped };

    // 4-way, snapped to the nearest; dead zone in the middle
    if (dist > 20) {
      const deg = (angle * 180) / Math.PI;
      if (deg >= -45 && deg < 45) this.currentDirection = Direction.Right;
      else if (deg >= 45 && deg < 135) this.currentDirection = Direction.Up;
      else if (deg >= -135 && deg < -45) this.currentDirection = Direction.Down;
      else this.currentDirection = Direction.Left;
    } else {
      this.currentDirection = null;
    }
  }

  private resetJoystick(): void {
    this.joystickKnob.position = { ...this._joystickPosition };
    this.currentDirection = null;
  }
}
