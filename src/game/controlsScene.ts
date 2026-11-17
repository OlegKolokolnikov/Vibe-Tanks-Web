import { Colors, rgb, white, withAlpha, type Color } from "../engine/color";
import type { Point } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Scene, type Touch } from "../engine/scene";
import type { View } from "../engine/view";
import { namedNodeAt } from "./menuScene";
import { OptionsScene } from "./optionsScene";
import { FirePlacementNames, GameSettings, KEY_ACTIONS, KeyActionInfo, SettingsInfo, nextFirePlacement, type FirePlacement, type KeyAction } from "./settings";
import { Tank } from "./tank";

/**
 * Options → Controls: keyboard keys for each player and the two-player touch layout.
 * Tap a key box, then press the new key (Escape cancels).
 */
export class ControlsScene extends Scene {
  private listening: { player: number; action: KeyAction } | null = null;
  private keyBoxes = new Map<string, Node>();
  private placementButtons: Node[] = [];
  private placementPreviews: Node[] = [];
  private messageLabel!: LabelNode;

  private get actionColumnX(): number {
    return this.size.width * 0.12;
  }
  private keyColumnX(player: number): number {
    return this.size.width * (player === 0 ? 0.26 : 0.4);
  }
  private rowY(index: number): number {
    return this.size.height * (0.64 - index * 0.095);
  }
  private get touchCenterX(): number {
    return this.size.width * 0.73;
  }
  private touchRowY(player: number): number {
    return this.size.height * (player === 0 ? 0.58 : 0.36);
  }

  didMove(_view: View): void {
    this.backgroundColor = Colors.black;
    const { width, height } = this.size;
    this.addChild(this.makeLabel("CONTROLS", 36, Colors.yellow, { x: width / 2, y: height * 0.87 }));

    this.setupKeyboardSection();
    this.setupTouchSection();

    this.messageLabel = this.makeLabel("", 14, Colors.gray, { x: width * 0.27, y: height * 0.17 });
    this.addChild(this.messageLabel);
    this.showDefaultMessage();

    const back = this.createButton("BACK", { x: width / 2 - 95, y: height * 0.08 });
    back.name = "backButton";
    this.addChild(back);
    const reset = this.createButton("RESET", { x: width / 2 + 95, y: height * 0.08 });
    reset.name = "resetButton";
    this.addChild(reset);
  }

  // MARK: - Layout

  private setupKeyboardSection(): void {
    this.addChild(this.makeLabel("KEYBOARD", 22, Colors.white, { x: this.size.width * 0.27, y: this.size.height * 0.76 }));
    for (let player = 0; player < 2; player++) {
      this.addChild(this.makeLabel(`${player + 1}P`, 18, Tank.colorForPlayer(player + 1), { x: this.keyColumnX(player), y: this.size.height * 0.7 }));
    }
    KEY_ACTIONS.forEach((action, index) => {
      const actionLabel = this.makeLabel(KeyActionInfo[action].displayName, 15, Colors.lightGray, { x: this.actionColumnX - 30, y: this.rowY(index) });
      actionLabel.horizontalAlignmentMode = "left";
      this.addChild(actionLabel);
      for (let player = 0; player < 2; player++) {
        const box = this.createKeyBox();
        box.position = { x: this.keyColumnX(player), y: this.rowY(index) };
        box.name = this.keyBoxName(player, action);
        this.addChild(box);
        this.keyBoxes.set(box.name, box);
      }
    });
    this.refreshKeyBoxes();
  }

  private setupTouchSection(): void {
    this.addChild(this.makeLabel("TOUCH (2 PLAYERS)", 22, Colors.white, { x: this.touchCenterX, y: this.size.height * 0.76 }));
    for (let player = 0; player < 2; player++) {
      const y = this.touchRowY(player);
      this.addChild(this.makeLabel(`${player + 1}P`, 18, Tank.colorForPlayer(player + 1), { x: this.touchCenterX - 150, y }));

      const button = this.createButton("", { x: this.touchCenterX - 15, y }, 170, 38);
      button.name = `placement${player}`;
      this.addChild(button);
      this.placementButtons.push(button);

      const preview = new Node();
      preview.position = { x: this.touchCenterX + 130, y };
      this.addChild(preview);
      this.placementPreviews.push(preview);
    }
    this.addChild(this.makeLabel("Tap to change where the fire button sits", 13, Colors.gray, { x: this.touchCenterX, y: this.size.height * 0.2 }));
    this.refreshPlacements();
  }

  // MARK: - Refresh

  private keyBoxName(player: number, action: KeyAction): string {
    return `key${player}_${action}`;
  }

  private refreshKeyBoxes(): void {
    for (let player = 0; player < 2; player++) {
      for (const action of KEY_ACTIONS) {
        const box = this.keyBoxes.get(this.keyBoxName(player, action));
        if (!box) continue;
        const isListening = this.listening?.player === player && this.listening.action === action;
        const bg = box.childNode("bg") as ShapeNode | null;
        if (bg) {
          bg.strokeColor = isListening ? Colors.yellow : Colors.gray;
          bg.fillColor = isListening ? rgb(0.35, 0.3, 0.0) : white(0.18);
        }
        const lbl = box.childNode("label") as LabelNode | null;
        if (lbl) lbl.text = isListening ? "?" : SettingsInfo.keyName(GameSettings.key(action, player));
      }
    }
  }

  private refreshPlacements(): void {
    for (let player = 0; player < 2; player++) {
      const placement = GameSettings.firePlacement(player);
      const lbl = this.placementButtons[player].childNode("label") as LabelNode | null;
      if (lbl) lbl.text = FirePlacementNames[placement];
      this.drawPreview(this.placementPreviews[player], placement, player);
    }
  }

  /** Tiny picture of that player's screen corner: joystick (gray) and fire button (red) */
  private drawPreview(node: Node, placement: FirePlacement, player: number): void {
    node.removeAllChildren();
    const width = 64;
    const height = 56;
    const frame = ShapeNode.rect(width, height, 6);
    frame.strokeColor = Colors.darkGray;
    frame.fillColor = white(0.08);
    node.addChild(frame);

    // Player 1 holds the left edge, player 2 the right edge
    const edgeSign = player === 0 ? -1 : 1;
    const edgeX = edgeSign * (width / 2 - 14);
    const innerX = edgeX - edgeSign * 26;
    const bottomY = -height / 2 + 14;
    const upperY = bottomY + 26;
    let joystick: Point;
    let fire: Point;
    switch (placement) {
      case "above":
        joystick = { x: edgeX, y: bottomY };
        fire = { x: edgeX, y: upperY };
        break;
      case "below":
        joystick = { x: edgeX, y: upperY };
        fire = { x: edgeX, y: bottomY };
        break;
      case "inside":
        joystick = { x: edgeX, y: bottomY };
        fire = { x: innerX, y: bottomY };
        break;
      case "outside":
        joystick = { x: innerX, y: bottomY };
        fire = { x: edgeX, y: bottomY };
        break;
    }

    const stick = ShapeNode.circle(10);
    stick.fillColor = withAlpha(Colors.gray, 0.5);
    stick.strokeColor = Tank.colorForPlayer(player + 1);
    stick.lineWidth = 2;
    stick.position = joystick;
    node.addChild(stick);

    const fireButton = ShapeNode.circle(8);
    fireButton.fillColor = withAlpha(Colors.red, 0.7);
    fireButton.strokeColor = Colors.red;
    fireButton.position = fire;
    node.addChild(fireButton);
  }

  private showDefaultMessage(): void {
    this.showMessage("Tap a key box, then press the new key", Colors.gray);
  }

  private showMessage(text: string, color: Color): void {
    this.messageLabel.fontColor = color;
    this.messageLabel.text = text;
  }

  // MARK: - Input

  touchesBegan(touches: Touch[]): void {
    const touch = touches[0];
    if (!touch) return;
    const name = namedNodeAt(this, touch.location, (n) => n !== "bg" && n !== "label");

    if (name === "backButton") return this.goBack();
    if (name === "resetButton") {
      GameSettings.resetKeys();
      for (let player = 0; player < 2; player++) GameSettings.setFirePlacement("above", player);
      this.listening = null;
      this.refreshKeyBoxes();
      this.refreshPlacements();
      this.showMessage("Default controls restored", Colors.green);
      return;
    }
    for (let player = 0; player < 2; player++) {
      if (name === `placement${player}`) {
        GameSettings.setFirePlacement(nextFirePlacement(GameSettings.firePlacement(player)), player);
        this.refreshPlacements();
        return;
      }
      for (const action of KEY_ACTIONS) {
        if (name === this.keyBoxName(player, action)) {
          this.listening = { player, action };
          this.refreshKeyBoxes();
          this.showMessage(`${player + 1}P ${KeyActionInfo[action].displayName}: press a key (Esc cancels)`, Colors.yellow);
          return;
        }
      }
    }

    // A tap anywhere else cancels a key change
    if (this.listening) {
      this.listening = null;
      this.refreshKeyBoxes();
      this.showDefaultMessage();
    }
  }

  keyDown(code: string, repeat: boolean): boolean {
    if (repeat) return true;
    const target = this.listening;
    if (!target) {
      if (code === "Escape") this.goBack();
      return code === "Escape";
    }
    if (code === "Escape") {
      this.listening = null;
      this.refreshKeyBoxes();
      this.showDefaultMessage();
      return true;
    }
    if (SettingsInfo.reservedKeys.has(code)) {
      this.showMessage("P and Esc pause the game, pick another key", Colors.orange);
      return true;
    }
    GameSettings.setKey(code, target.action, target.player);
    this.listening = null;
    this.refreshKeyBoxes();
    this.showMessage(`${target.player + 1}P ${KeyActionInfo[target.action].displayName} = ${SettingsInfo.keyName(code)}`, Colors.green);
    return true;
  }

  // MARK: - Helpers

  private makeLabel(text: string, size: number, color: Color, position: Point): LabelNode {
    const lbl = new LabelNode(text, "Helvetica-Bold");
    lbl.fontSize = size;
    lbl.fontColor = color;
    lbl.verticalAlignmentMode = "center";
    lbl.position = position;
    return lbl;
  }

  private createKeyBox(): Node {
    const container = new Node();
    const bg = ShapeNode.rect(96, 30, 6);
    bg.lineWidth = 2;
    bg.name = "bg";
    container.addChild(bg);
    const lbl = this.makeLabel("", 15, Colors.white, { x: 0, y: 0 });
    lbl.name = "label";
    container.addChild(lbl);
    return container;
  }

  private createButton(text: string, position: Point, width = 160, height = 45): Node {
    const container = new Node();
    container.position = position;
    const background = ShapeNode.rect(width, height, 8);
    background.fillColor = white(0.2);
    background.strokeColor = Colors.yellow;
    background.lineWidth = 2;
    background.name = "bg";
    container.addChild(background);
    const lbl = this.makeLabel(text, height < 45 ? 17 : 22, Colors.white, { x: 0, y: 0 });
    lbl.name = "label";
    container.addChild(lbl);
    return container;
  }

  private goBack(): void {
    this.view?.present(new OptionsScene(this.size), 0.3);
  }
}
