import { Colors, darker, rgb, white } from "../engine/color";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Scene, type Touch } from "../engine/scene";
import type { View } from "../engine/view";
import type { Color } from "../engine/color";
import type { Point, Rect } from "../engine/geometry";
import { ControlsScene } from "./controlsScene";
import { MenuScene, createMenuButton, namedNodeAt } from "./menuScene";
import { GameSettings, SettingsInfo, TANK_COLORS, TankColors, type TankColor } from "./settings";
import { SoundManager } from "./sound";

const SEGMENT_WIDTH = 14;
const SEGMENT_SPACING = 3;
const SELECTED_FILL = rgb(0.2, 0.5, 0.2);
const BUTTON_FILL = white(0.2);

function label(text: string, fontName: string, fontSize: number, color: Color, position: Point): LabelNode {
  const node = new LabelNode(text, fontName);
  node.fontSize = fontSize;
  node.fontColor = color;
  node.position = position;
  return node;
}

export class OptionsScene extends Scene {
  private controlsToggle = new Node();
  /** Color buttons per player (index 0 = player 1, 1 = player 2) */
  private colorButtons: Map<TankColor, Node>[] = [new Map(), new Map()];
  private tankPreviews: Node[] = [];
  private volumeLabel: LabelNode | null = null;
  private volumeSegments: ShapeNode[] = [];
  private volumeBarFrame: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private isDraggingVolume = false;

  private get leftColumnX(): number {
    return this.size.width * 0.27;
  }
  private get rightColumnX(): number {
    return this.size.width * 0.73;
  }

  didMove(_view: View): void {
    this.backgroundColor = Colors.black;
    const { width, height } = this.size;
    this.addChild(label("OPTIONS", "Helvetica-Bold", 42, Colors.yellow, { x: width / 2, y: height * 0.85 }));

    this.setupControlsSection();
    this.setupVolumeSection();
    this.setupColorSection();

    const back = createMenuButton("BACK", { x: width / 2 - 95, y: height * 0.1 }, 160, 45, 22);
    back.name = "backButton";
    this.addChild(back);
    const controls = createMenuButton("CONTROLS", { x: width / 2 + 95, y: height * 0.1 }, 160, 45, 22);
    controls.name = "controlsButton";
    this.addChild(controls);
  }

  // MARK: - Controls position

  private setupControlsSection(): void {
    const sectionY = this.size.height * 0.66;
    this.addChild(label("Controls Position", "Helvetica-Bold", 24, Colors.white, { x: this.leftColumnX, y: sectionY + 30 }));

    this.controlsToggle.position = { x: this.leftColumnX, y: sectionY - 20 };
    this.addChild(this.controlsToggle);
    const left = this.createToggleOption("Fire LEFT", GameSettings.controlsSwapped, -70);
    left.name = "fireLeft";
    this.controlsToggle.addChild(left);
    const right = this.createToggleOption("Fire RIGHT", !GameSettings.controlsSwapped, 70);
    right.name = "fireRight";
    this.controlsToggle.addChild(right);

    this.addChild(label("Swaps joystick and fire button positions", "Helvetica", 14, Colors.gray, { x: this.leftColumnX, y: sectionY - 60 }));
  }

  private createToggleOption(text: string, isSelected: boolean, xOffset: number): Node {
    const container = new Node();
    container.position = { x: xOffset, y: 0 };
    const bg = ShapeNode.rect(130, 45, 6);
    bg.lineWidth = 2;
    bg.name = "bg";
    container.addChild(bg);
    const lbl = label(text, "Helvetica-Bold", 18, Colors.gray, { x: 0, y: 0 });
    lbl.verticalAlignmentMode = "center";
    lbl.name = "label";
    container.addChild(lbl);
    this.updateToggleVisual(container, isSelected);
    return container;
  }

  private setControlsSwapped(swapped: boolean): void {
    GameSettings.controlsSwapped = swapped;
    const left = this.controlsToggle.childNode("fireLeft");
    const right = this.controlsToggle.childNode("fireRight");
    if (left) this.updateToggleVisual(left, swapped);
    if (right) this.updateToggleVisual(right, !swapped);
  }

  private updateToggleVisual(node: Node, isSelected: boolean): void {
    const bg = node.childNode("bg") as ShapeNode | null;
    if (bg) {
      bg.fillColor = isSelected ? SELECTED_FILL : BUTTON_FILL;
      bg.strokeColor = isSelected ? Colors.green : Colors.gray;
    }
    const lbl = node.childNode("label") as LabelNode | null;
    if (lbl) lbl.fontColor = isSelected ? Colors.white : Colors.gray;
  }

  // MARK: - Volume

  private setupVolumeSection(): void {
    const sectionY = this.size.height * 0.34;
    const levels = SettingsInfo.maxVolumeLevel;

    this.volumeLabel = label("", "Helvetica-Bold", 24, Colors.white, { x: this.leftColumnX, y: sectionY + 30 });
    this.addChild(this.volumeLabel);

    // Segmented bar: tap or drag to set the volume
    const barY = sectionY - 20;
    const step = SEGMENT_WIDTH + SEGMENT_SPACING;
    const barWidth = levels * step - SEGMENT_SPACING;
    const barLeft = this.leftColumnX - barWidth / 2;
    for (let i = 0; i < levels; i++) {
      const segment = ShapeNode.rect(SEGMENT_WIDTH, 24, 2);
      segment.position = { x: barLeft + i * step + SEGMENT_WIDTH / 2, y: barY };
      segment.lineWidth = 1;
      this.addChild(segment);
      this.volumeSegments.push(segment);
    }
    // Generous vertical padding so the bar is easy to hit with a finger
    this.volumeBarFrame = { x: barLeft, y: barY - 22, width: barWidth, height: 44 };

    const minus = this.createSmallButton("−", { x: barLeft - 32, y: barY });
    minus.name = "volumeMinus";
    this.addChild(minus);
    const plus = this.createSmallButton("+", { x: barLeft + barWidth + 32, y: barY });
    plus.name = "volumePlus";
    this.addChild(plus);

    this.updateVolumeDisplay();
  }

  private createSmallButton(text: string, position: Point): Node {
    return createMenuButton(text, position, 40, 40, 26);
  }

  private updateVolumeDisplay(): void {
    const level = SoundManager.volumeLevel;
    const percent = Math.floor((level * 100) / SettingsInfo.maxVolumeLevel);
    if (this.volumeLabel) {
      this.volumeLabel.text = SoundManager.isMuted ? "Volume: Muted" : level === 0 ? "Volume: Off" : `Volume: ${percent}%`;
    }
    this.volumeSegments.forEach((segment, i) => {
      const isOn = i < level;
      segment.fillColor = isOn ? rgb(0.2, 0.8, 0.2) : BUTTON_FILL;
      segment.strokeColor = isOn ? Colors.green : Colors.gray;
    });
  }

  private setVolumeLevel(level: number): void {
    const clamped = Math.min(Math.max(level, 0), SettingsInfo.maxVolumeLevel);
    // Touching the volume control while muted unmutes, so the change is audible
    if (clamped === SoundManager.volumeLevel && !SoundManager.isMuted) return;
    SoundManager.isMuted = false;
    SoundManager.volumeLevel = clamped;
    this.updateVolumeDisplay();
    SoundManager.playShoot(); // Short sample of the new level
  }

  /** Bar x position → volume level (left edge = off) */
  private setVolumeFromBar(x: number): void {
    const f = this.volumeBarFrame;
    const fraction = Math.min(Math.max((x - f.x) / f.width, 0), 1);
    this.setVolumeLevel(Math.ceil(fraction * SettingsInfo.maxVolumeLevel));
  }

  // MARK: - Tank color

  private setupColorSection(): void {
    const sectionY = this.size.height * 0.66;
    this.addChild(label("Tank Color", "Helvetica-Bold", 24, Colors.white, { x: this.rightColumnX, y: sectionY + 30 }));

    // One row of colors per player: [1P] (o) (o) (o) (o) [tank preview]
    const spacing = 70;
    const totalWidth = (TANK_COLORS.length - 1) * spacing;
    const startX = this.rightColumnX - totalWidth / 2;
    const rowSpacing = 80;

    for (let player = 0; player < 2; player++) {
      const rowY = sectionY - 20 - player * rowSpacing;
      const playerLabel = label(`${player + 1}P`, "Helvetica-Bold", 20, Colors.white, { x: startX - 60, y: rowY });
      playerLabel.verticalAlignmentMode = "center";
      this.addChild(playerLabel);

      TANK_COLORS.forEach((tankColor, index) => {
        const button = this.createColorButton(tankColor);
        button.position = { x: startX + index * spacing, y: rowY };
        button.name = `color${player}_${tankColor}`;
        this.addChild(button);
        this.colorButtons[player].set(tankColor, button);
      });

      const preview = new Node();
      preview.position = { x: startX + totalWidth + 60, y: rowY };
      this.addChild(preview);
      this.tankPreviews.push(preview);
    }
    this.updateColorButtons();
    this.updateTankPreviews();
  }

  private selectedColor(player: number): TankColor {
    return player === 0 ? GameSettings.playerTankColor : GameSettings.player2TankColor;
  }

  private createColorButton(tankColor: TankColor): Node {
    const container = new Node();
    const circle = ShapeNode.circle(22);
    circle.fillColor = TankColors[tankColor].color;
    circle.strokeColor = Colors.gray;
    circle.lineWidth = 2;
    circle.name = "circle";
    container.addChild(circle);
    const lbl = label(TankColors[tankColor].displayName, "Helvetica", 12, Colors.gray, { x: 0, y: -36 });
    lbl.name = "colorLabel";
    container.addChild(lbl);
    return container;
  }

  private updateTankPreviews(): void {
    this.tankPreviews.forEach((preview, player) => {
      preview.removeAllChildren();
      preview.addChild(this.createPreviewTank(TankColors[this.selectedColor(player)].color, 32));
    });
  }

  /** Simple tank drawing for the color preview */
  private createPreviewTank(color: Color, tankSize: number): Node {
    const tank = new Node();
    const dark = darker(color, 0.2);
    const body = ShapeNode.rect(tankSize, tankSize * 0.8, 4);
    body.fillColor = color;
    body.strokeColor = dark;
    body.lineWidth = 2;
    tank.addChild(body);

    const turret = ShapeNode.circle(tankSize * 0.25);
    turret.fillColor = dark;
    turret.strokeColor = darker(dark, 0.2);
    turret.position = { x: 0, y: 2 };
    tank.addChild(turret);

    const gun = ShapeNode.rect(6, tankSize * 0.5, 2);
    gun.fillColor = dark;
    gun.strokeColor = Colors.black;
    gun.position = { x: 0, y: tankSize * 0.4 };
    tank.addChild(gun);

    for (const side of [-1, 1]) {
      const track = ShapeNode.rect(tankSize * 0.2, tankSize * 0.9);
      track.fillColor = white(0.3);
      track.strokeColor = Colors.black;
      track.position = { x: side * tankSize * 0.45, y: 0 };
      tank.addChild(track);
    }
    return tank;
  }

  private setTankColor(color: TankColor, player: number): void {
    // Both tanks can't have the same color
    if (color === this.selectedColor(1 - player)) return;
    if (player === 0) GameSettings.playerTankColor = color;
    else GameSettings.player2TankColor = color;
    this.updateColorButtons();
    this.updateTankPreviews();
  }

  /** Selected color: white ring + check mark. The other player's color: dimmed with a cross. */
  private updateColorButtons(): void {
    for (let player = 0; player < 2; player++) {
      const selected = this.selectedColor(player);
      const taken = this.selectedColor(1 - player);
      for (const [tankColor, button] of this.colorButtons[player]) {
        const isSelected = tankColor === selected;
        const isTaken = tankColor === taken;
        button.alpha = isTaken ? 0.3 : 1.0;
        const circle = button.childNode("circle") as ShapeNode | null;
        if (circle) {
          circle.strokeColor = isSelected ? Colors.white : Colors.gray;
          circle.lineWidth = isSelected ? 4 : 2;
        }
        button.childNode("check")?.removeFromParent();
        if (isSelected || isTaken) {
          const mark = label(isSelected ? "✓" : "✕", "Helvetica-Bold", 22, Colors.black, { x: 0, y: 0 });
          mark.verticalAlignmentMode = "center";
          mark.name = "check";
          button.addChild(mark);
        }
        const lbl = button.childNode("colorLabel") as LabelNode | null;
        if (lbl) lbl.fontColor = isSelected ? Colors.white : Colors.gray;
      }
    }
  }

  // MARK: - Input

  touchesBegan(touches: Touch[]): void {
    const touch = touches[0];
    if (!touch) return;
    const p = touch.location;
    const f = this.volumeBarFrame;
    if (p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height) {
      this.isDraggingVolume = true;
      this.setVolumeFromBar(p.x);
      return;
    }

    const inner = new Set(["bg", "label", "circle", "colorLabel", "check"]);
    const name = namedNodeAt(this, p, (n) => !inner.has(n));
    switch (name) {
      case "backButton":
        this.view?.present(new MenuScene(this.size), 0.3);
        return;
      case "controlsButton":
        this.view?.present(new ControlsScene(this.size), 0.3);
        return;
      case "volumeMinus":
        return this.setVolumeLevel(SoundManager.volumeLevel - 1);
      case "volumePlus":
        return this.setVolumeLevel(SoundManager.volumeLevel + 1);
      case "fireLeft":
        return this.setControlsSwapped(true);
      case "fireRight":
        return this.setControlsSwapped(false);
    }
    const match = name?.match(/^color([01])_(\w+)$/);
    if (match) this.setTankColor(match[2] as TankColor, Number(match[1]));
  }

  touchesMoved(touches: Touch[]): void {
    const touch = touches[0];
    if (this.isDraggingVolume && touch) this.setVolumeFromBar(touch.location.x);
  }

  touchesEnded(_touches: Touch[]): void {
    this.isDraggingVolume = false;
  }

  /** Escape goes back to the menu */
  keyDown(code: string, _repeat: boolean): boolean {
    if (code === "Escape") {
      this.view?.present(new MenuScene(this.size), 0.3);
      return true;
    }
    return false;
  }
}
