import { Action } from "../engine/actions";
import { Colors, rgb, white, withAlpha, type Color } from "../engine/color";
import { type Point } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Path } from "../engine/path";
import { Scene, type Touch } from "../engine/scene";
import type { View } from "../engine/view";
import { CheatScene } from "./cheatScene";
import { CheatSettings } from "./cheatSettings";
import { GameScene } from "./gameScene";
import { SoundManager } from "./sound";
import { OptionsScene } from "./optionsScene";

type P = [number, number];

/** Shape helper: path, fill, stroke, line width */
function shape(path: Path, fillColor: Color, strokeColor: Color = Colors.clear, lineWidth = 1): ShapeNode {
  const node = new ShapeNode(path);
  node.fillColor = fillColor;
  node.strokeColor = strokeColor;
  node.lineWidth = lineWidth;
  return node;
}

function at<T extends Node>(node: T, x: number, y: number): T {
  node.position = { x, y };
  return node;
}

function polygon(points: P[]): Path {
  const path = new Path().moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) path.lineTo(x, y);
  return path.close();
}

function line(from: P, to: P): Path {
  return new Path().moveTo(from[0], from[1]).lineTo(to[0], to[1]);
}

/** Five-pointed star */
export function createStar(size: number, color: Color): ShapeNode {
  const path = new Path();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? size : size * 0.4;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.close();
  return shape(path, color, Colors.darkGray, 0.5);
}

/** Menu button: dark plate with a yellow frame */
export function createMenuButton(text: string, position: Point, width = 200, height = 50, fontSize = 24): Node {
  const container = new Node();
  container.position = position;
  const background = ShapeNode.rect(width, height, 8);
  background.fillColor = white(0.2);
  background.strokeColor = Colors.yellow;
  background.lineWidth = 2;
  container.addChild(background);
  const label = new LabelNode(text, "Helvetica-Bold");
  label.fontSize = fontSize;
  label.fontColor = Colors.white;
  label.verticalAlignmentMode = "center";
  container.addChild(label);
  return container;
}

/** Name of the named node (or its named parent chain) under a scene point */
export function namedNodeAt(scene: Node, point: Point, accept: (name: string) => boolean = () => true): string | null {
  for (const node of scene.nodesAt(point)) {
    let n: Node | null = node;
    while (n && n !== scene) {
      if (n.name && accept(n.name)) return n.name;
      n = n.parent;
    }
  }
  return null;
}

/** ↑↑↓↓←→←→ B A on a keyboard; on a touch screen the same swipes, then two taps */
type CodeInput = "up" | "down" | "left" | "right" | "b" | "a" | "tap";
const DIRECTIONS: CodeInput[] = ["up", "up", "down", "down", "left", "right", "left", "right"];
const KEYBOARD_CODE: CodeInput[] = [...DIRECTIONS, "b", "a"];
const TOUCH_CODE: CodeInput[] = [...DIRECTIONS, "tap", "tap"];

export class MenuScene extends Scene {
  private codeInputs: CodeInput[] = [];
  private touchStart: Point | null = null;

  didMove(_view: View): void {
    this.backgroundColor = Colors.black;
    const { width, height } = this.size;

    const title = new LabelNode("VIBE TANKS", "Helvetica-Bold");
    title.fontSize = 48;
    title.fontColor = Colors.yellow;
    this.addChild(at(title, width / 2, height * 0.75));

    const subtitle = new LabelNode("Tank Battle Game", "Helvetica");
    subtitle.fontSize = 20;
    subtitle.fontColor = Colors.white;
    this.addChild(at(subtitle, width / 2, height * 0.75 - 35));

    const decoration = new Node();
    decoration.addChild(this.createProfileTankWithSkull());
    decoration.run(Action.repeatForever(Action.sequence([Action.scaleYTo(1.03, 1.5), Action.scaleYTo(0.97, 1.5)])));
    this.addChild(at(decoration, width / 2, height * 0.48));

    const one = createMenuButton("1 PLAYER", { x: width / 2 - 110, y: height * 0.3 });
    one.name = "onePlayerButton";
    this.addChild(one);
    const two = createMenuButton("2 PLAYERS", { x: width / 2 + 110, y: height * 0.3 });
    two.name = "twoPlayersButton";
    this.addChild(two);
    const options = createMenuButton("OPTIONS", { x: width / 2, y: height * 0.2 });
    options.name = "optionsButton";
    this.addChild(options);
    if (CheatSettings.isUnlocked) this.addCheatsButton();

    const credits = new LabelNode("Designed by Oleg", "Helvetica-Bold");
    credits.fontSize = 14;
    credits.fontColor = Colors.lightGray;
    this.addChild(at(credits, width / 2, height * 0.03));
  }

  // MARK: - Konami code

  private registerCodeInput(input: CodeInput): void {
    if (CheatSettings.isUnlocked) return;
    this.codeInputs.push(input);
    if (this.codeInputs.length > KEYBOARD_CODE.length) this.codeInputs.shift();
    const matches = (code: CodeInput[]) => code.length === this.codeInputs.length && code.every((c, i) => c === this.codeInputs[i]);
    if (matches(KEYBOARD_CODE) || matches(TOUCH_CODE)) this.unlockCheats();
  }

  private unlockCheats(): void {
    CheatSettings.isUnlocked = true;
    this.codeInputs = [];
    SoundManager.playPowerUp();
    this.addCheatsButton();

    const text = new LabelNode("CHEATS UNLOCKED!", "Helvetica-Bold");
    text.fontSize = 28;
    text.fontColor = Colors.magenta;
    at(text, this.size.width / 2, this.size.height * 0.75 - 75);
    text.setScale(0.2);
    this.addChild(text);
    text.run(
      Action.sequence([Action.scaleTo(1.15, 0.25), Action.scaleTo(1.0, 0.1), Action.wait(1.8), Action.fadeOut(0.5), Action.removeFromParent()]),
    );
  }

  /** OPTIONS moves left and CHEATS sits on its right */
  private addCheatsButton(): void {
    if (this.childNode("cheatsButton")) return;
    const rowY = this.size.height * 0.2;
    const options = this.childNode("optionsButton");
    if (options) options.position = { x: this.size.width / 2 - 110, y: rowY };
    const cheats = createMenuButton("CHEATS", { x: this.size.width / 2 + 110, y: rowY });
    cheats.name = "cheatsButton";
    const background = cheats.children[0] as ShapeNode | undefined;
    if (background) background.strokeColor = Colors.magenta;
    this.addChild(cheats);
  }

  private openCheats(): void {
    this.view?.present(new CheatScene(this.size), 0.3);
  }

  touchesBegan(touches: Touch[]): void {
    const touch = touches[0];
    if (!touch) return;
    switch (namedNodeAt(this, touch.location)) {
      case "onePlayerButton":
        return this.startGame(1);
      case "twoPlayersButton":
        return this.startGame(2);
      case "optionsButton":
        this.view?.present(new OptionsScene(this.size), 0.3);
        return;
      case "cheatsButton":
        return this.openCheats();
    }
    this.touchStart = { ...touch.location }; // Not on a button: a swipe or tap for the code
  }

  touchesEnded(touches: Touch[]): void {
    const start = this.touchStart;
    const touch = touches[0];
    this.touchStart = null;
    if (!start || !touch) return;
    const dx = touch.location.x - start.x;
    const dy = touch.location.y - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) this.registerCodeInput("tap");
    else if (Math.abs(dx) > Math.abs(dy)) this.registerCodeInput(dx > 0 ? "right" : "left");
    else this.registerCodeInput(dy > 0 ? "up" : "down"); // Scene y goes up
  }

  touchesCancelled(_touches: Touch[]): void {
    this.touchStart = null;
  }

  /** Keyboard: Enter, Space or 1 = one player, 2 = two players, C = cheats (once unlocked) */
  keyDown(code: string, repeat: boolean): boolean {
    if (repeat) return false;
    const codeKeys: Record<string, CodeInput> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyB: "b", KeyA: "a" };
    if (codeKeys[code]) {
      this.registerCodeInput(codeKeys[code]);
      return code.startsWith("Arrow"); // Arrows would scroll the page
    }
    if (code === "KeyC" && CheatSettings.isUnlocked) {
      this.openCheats();
      return true;
    }
    this.codeInputs = [];
    switch (code) {
      case "Enter":
      case "NumpadEnter":
      case "Space":
      case "Digit1":
      case "Numpad1":
        this.startGame(1);
        return true;
      case "Digit2":
      case "Numpad2":
        this.startGame(2);
        return true;
    }
    return false;
  }

  private startGame(playerCount: number): void {
    // New random session seed; cheats may set the start level, lives and power-ups
    this.view?.present(GameScene.newGame(this.size, playerCount), 0.5);
  }

  // MARK: - Decoration: tank in profile with a skull commander

  private createProfileTankWithSkull(): Node {
    const tank = new Node();
    const tankGreen = rgb(0.28, 0.38, 0.2);
    const tankDark = rgb(0.18, 0.25, 0.12);
    const tankLight = rgb(0.38, 0.48, 0.28);
    const metalDark = white(0.15);
    const metalMid = white(0.3);
    const metalLight = white(0.45);
    const add = (n: Node) => tank.addChild(n);

    // Tracks: housing
    add(
      shape(
        new Path().moveTo(-50, -12).lineTo(-55, -18).quadTo(-58, -28, -50, -35).lineTo(45, -35).quadTo(53, -28, 50, -18).lineTo(45, -12).close(),
        metalDark,
        Colors.black,
        2,
      ),
    );
    // Track links
    for (let i = 0; i < 22; i++) {
      let x: number;
      let y: number;
      if (i < 10) {
        x = -45 + i * 9.5;
        y = -33;
      } else if (i < 12) {
        x = 48 - (i - 10) * 3;
        y = -30 + (i - 10) * 6;
      } else {
        x = 45 - (i - 12) * 9.5;
        y = -17;
      }
      add(at(shape(Path.rectCentered(3, 6), metalMid, metalDark, 0.5), x, y));
    }
    // Road wheels
    [-38, -19, 0, 19, 38].forEach((xPos, index) => {
      add(at(shape(Path.circle(10), metalMid, metalDark, 2), xPos, -25));
      add(at(shape(Path.circle(8), white(0.2), metalDark, 1), xPos, -25));
      add(at(shape(Path.circle(4), metalLight, metalDark, 1), xPos, -25));
      for (let j = 0; j < 5; j++) {
        const a = (j * Math.PI * 2) / 5 + index * 0.5;
        add(at(shape(Path.circle(1), metalDark), xPos + Math.cos(a) * 2.5, -25 + Math.sin(a) * 2.5));
      }
    });
    add(at(shape(Path.circle(7), metalMid, metalDark, 1.5), -48, -22)); // Drive sprocket
    add(at(shape(Path.circle(6), metalMid, metalDark, 1.5), 48, -22)); // Idler

    // Hull
    add(shape(polygon([[-48, -10], [-42, 5], [50, 5], [55, -5], [50, -10]]), tankGreen, tankDark, 2));
    add(shape(polygon([[-40, 5], [-35, 18], [40, 18], [48, 5]]), tankGreen, tankDark, 2));
    add(shape(line([-35, 17], [40, 17]), Colors.clear, tankLight, 1.5));
    add(at(shape(Path.rectCentered(20, 8), metalDark, metalMid, 1), -28, 12));
    for (let i = 0; i < 4; i++) add(at(shape(Path.rectCentered(1, 6), metalMid), -34 + i * 5, 12));

    // Turret
    add(
      shape(
        new Path().moveTo(-5, 15).quadTo(-18, 15, -20, 25).quadTo(-25, 35, -15, 40).lineTo(15, 40).quadTo(22, 38, 25, 28).lineTo(20, 20).lineTo(5, 15).close(),
        tankGreen,
        tankDark,
        2,
      ),
    );
    add(shape(line([-15, 39], [15, 39]), Colors.clear, tankLight, 1.5));
    add(at(shape(Path.ellipse(18, 8), tankDark, Colors.black, 1.5), -5, 42)); // Cupola
    add(at(shape(Path.ellipse(14, 6), white(0.05), tankDark, 1), -5, 43)); // Hatch

    // Gun
    add(shape(new Path().moveTo(18, 22).quadTo(28, 24, 25, 30).quadTo(28, 36, 18, 38).lineTo(15, 35).lineTo(15, 25).close(), tankDark, Colors.black, 1.5));
    add(at(shape(Path.rectCentered(55, 7, 1), metalDark, Colors.black, 1.5), 52, 30));
    add(shape(line([25, 32], [78, 32]), Colors.clear, metalLight, 1));
    add(shape(polygon([[78, 25], [85, 24], [85, 36], [78, 35]]), metalDark, Colors.black, 1.5));
    for (let i = 0; i < 3; i++) add(at(shape(Path.rectCentered(1.5, 4), Colors.black), 80 + i * 2, 30));

    // Details: tow cable, star, shovel
    const cable = shape(new Path().moveTo(45, 0).quadTo(55, 2, 52, 8), Colors.clear, rgb(0.35, 0.3, 0.2), 3);
    cable.lineCap = "round";
    add(cable);
    add(at(createStar(12, Colors.red), 0, 28));
    const handle = at(shape(Path.rectCentered(25, 2), rgb(0.4, 0.3, 0.2), rgb(0.3, 0.2, 0.1), 0.5), 15, 8);
    handle.zRotation = 0.1;
    add(handle);
    const head = at(shape(Path.rectCentered(6, 8), metalMid, metalDark, 0.5), 28, 9);
    head.zRotation = 0.1;
    add(head);

    add(at(this.createProfileSkull(), -5, 62));
    return tank;
  }

  /** Skull in profile (facing right) with a tanker helmet */
  private createProfileSkull(): Node {
    const skull = new Node();
    const add = (n: Node) => skull.addChild(n);
    const boneLight = rgb(0.95, 0.92, 0.85);
    const boneMid = rgb(0.85, 0.8, 0.7);
    const boneDark = rgb(0.6, 0.55, 0.45);
    const boneShade = rgb(0.5, 0.45, 0.35);
    const helmetMain = rgb(0.25, 0.2, 0.15);
    const helmetDark = rgb(0.15, 0.12, 0.08);
    const helmetLight = rgb(0.35, 0.28, 0.2);

    // Cranium
    add(
      shape(
        new Path()
          .moveTo(-18, 5)
          .quadTo(-22, 0, -20, -5)
          .quadTo(-18, -10, -12, -12)
          .lineTo(-8, -10)
          .lineTo(-5, -15)
          .lineTo(8, -18)
          .quadTo(12, -20, 14, -14)
          .lineTo(16, -8)
          .lineTo(18, -4)
          .quadTo(20, 0, 14, 4)
          .lineTo(12, 8)
          .quadTo(12, 14, 5, 15)
          .quadTo(-8, 18, -18, 5)
          .close(),
        boneLight,
        boneDark,
        2,
      ),
    );
    add(shape(new Path().moveTo(-5, 8).quadTo(-12, 5, -10, -2).quadTo(-8, -2, -2, 2).close(), boneMid)); // Temporal fossa
    add(shape(new Path().moveTo(-2, -2).lineTo(10, -1).quadTo(13, -1, 14, -4).lineTo(12, -6).lineTo(0, -5).close(), boneLight, boneDark, 1)); // Cheekbone

    // Eye socket and glowing eye
    add(
      shape(
        new Path().moveTo(2, 6).quadTo(8, 8, 12, 4).quadTo(15, 0, 12, -3).quadTo(8, -6, 4, -4).quadTo(0, 2, 2, 6).close(),
        rgb(0.08, 0.05, 0.02),
        boneShade,
        1.5,
      ),
    );
    add(at(shape(Path.ellipse(7, 8), rgb(0.15, 0.1, 0.05)), 7, 1));
    add(at(shape(Path.circle(3), rgb(1.0, 0.3, 0.1, 0.8)), 7, 1));
    add(at(shape(Path.circle(1.5), rgb(1.0, 0.8, 0.3)), 7, 1));

    // Nose
    add(shape(new Path().moveTo(14, 0).quadTo(18, -2, 16, -5).lineTo(14, -6).quadTo(12, -3, 14, 0).close(), rgb(0.1, 0.08, 0.05), boneShade, 1));
    add(shape(new Path().moveTo(12, 5).lineTo(14, 2).lineTo(13, 0), Colors.clear, boneDark, 1));

    // Teeth
    add(shape(polygon([[10, -7], [17, -5], [17, -8], [10, -10]]), boneLight, boneDark, 1));
    for (let i = 0; i < 4; i++) add(shape(line([11 + i * 2, -7], [11 + i * 2, -10]), Colors.clear, boneDark, 0.5));
    add(shape(polygon([[8, -11], [16, -9], [16, -12], [8, -14]]), boneLight, boneDark, 1));
    for (let i = 0; i < 4; i++) add(shape(line([9 + i * 2, -11], [9 + i * 2, -14]), Colors.clear, boneDark, 0.5));

    // Sutures and forehead highlight
    add(shape(new Path().moveTo(-5, 12).quadTo(-10, 10, -12, 5), Colors.clear, boneDark, 0.5));
    add(shape(new Path().moveTo(0, 10).quadTo(-5, 3, -8, -5), Colors.clear, boneDark, 0.5));
    add(at(shape(Path.ellipse(8, 5), withAlpha(Colors.white, 0.15)), 3, 10));

    // Tanker helmet
    add(
      shape(
        new Path().moveTo(-22, 5).quadTo(-25, 12, -18, 18).quadTo(-5, 24, 8, 22).quadTo(14, 20, 15, 14).lineTo(12, 8).quadTo(-5, 15, -22, 5).close(),
        helmetMain,
        helmetDark,
        2,
      ),
    );
    add(shape(new Path().moveTo(-20, 6).quadTo(-5, 13, 12, 9), Colors.clear, rgb(0.5, 0.35, 0.2), 3)); // Padding
    add(shape(new Path().moveTo(-5, 22).quadTo(-12, 18, -15, 10), Colors.clear, helmetDark, 1.5)); // Seam
    add(shape(new Path().moveTo(-10, 18).quadTo(-2, 21, 5, 20), Colors.clear, helmetLight, 2)); // Highlight
    add(shape(new Path().moveTo(-18, 12).quadTo(-3, 18, 10, 15), Colors.clear, white(0.2), 2.5)); // Goggle strap
    add(at(shape(Path.ellipse(10, 7), rgb(0.15, 0.2, 0.25), rgb(0.3, 0.25, 0.2), 2), 0, 15));
    add(at(shape(Path.ellipse(3, 2), withAlpha(Colors.white, 0.3)), -2, 16));
    add(at(createStar(6, Colors.red), -12, 14));
    return skull;
  }
}
