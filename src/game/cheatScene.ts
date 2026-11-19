import { Colors, rgb, white, type Color } from "../engine/color";
import type { Point } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Scene, type Touch } from "../engine/scene";
import type { View } from "../engine/view";
import { CheatSettings, defaultCheatConfig, type CheatConfig } from "./cheatSettings";
import { MenuScene, createMenuButton, namedNodeAt } from "./menuScene";
import { SoundManager } from "./sound";

/** Cheat screen pages */
enum Page {
  Player,
  PowerUps,
  Enemies,
  Crazy,
}
const PAGES = [Page.Player, Page.PowerUps, Page.Enemies, Page.Crazy];
const PAGE_TITLES: Record<Page, string> = {
  [Page.Player]: "PLAYER",
  [Page.PowerUps]: "POWER-UPS",
  [Page.Enemies]: "ENEMIES",
  [Page.Crazy]: "CRAZY",
};

interface Row {
  title: string;
  value: (c: CheatConfig) => string;
  change: (c: CheatConfig, delta: number) => void;
}

type NumberKey = { [K in keyof CheatConfig]: CheatConfig[K] extends number ? K : never }[keyof CheatConfig];
type BoolKey = { [K in keyof CheatConfig]: CheatConfig[K] extends boolean ? K : never }[keyof CheatConfig];

const ACCENT = Colors.magenta;
const ROW_FILL = white(0.15);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Step through a list of values (clamped at both ends) */
function stepped(current: number, steps: number[], delta: number): number {
  let index = steps.findIndex((s) => s >= current);
  if (index < 0) index = steps.length - 1;
  return steps[Math.min(Math.max(index + delta, 0), steps.length - 1)];
}

function listRow(title: string, key: NumberKey, steps: number[], format: (v: number) => string = String): Row {
  return {
    title,
    value: (c) => format(c[key]),
    change: (c, delta) => {
      c[key] = stepped(c[key], steps, delta);
    },
  };
}

function boolRow(title: string, key: BoolKey, on = "ON", off = "OFF"): Row {
  return {
    title,
    value: (c) => (c[key] ? on : off),
    change: (c) => {
      c[key] = !c[key];
    },
  };
}

const factor = (v: number) => `${v}x`;
const auto = (v: number) => (v === 0 ? "AUTO" : String(v));

function rowsFor(page: Page): Row[] {
  const S = CheatSettings;
  switch (page) {
    case Page.Player:
      return [
        listRow("SPEED", "playerSpeed", S.factorSteps, factor),
        listRow("FIRE RATE", "playerFireRate", S.factorSteps, factor),
        listRow("LIVES", "playerLives", S.livesSteps),
        listRow("START LEVEL", "startLevel", S.levelSteps),
      ];
    case Page.PowerUps:
      return [
        listRow("⭐ STAR", "stars", range(0, 3)),
        listRow("💥 MACHINEGUN", "machineguns", range(0, 3)),
        listRow("🚗 CAR", "cars", range(0, 5)),
        boolRow("🔫 GUN", "gun"),
        boolRow("🚢 SHIP", "ship"),
        boolRow("🪚 SAW", "saw"),
        boolRow("🛡️ SHIELD", "shield"),
        boolRow("🔦 LASER", "laser"),
        boolRow("🔮 MAGIC", "magic"),
        boolRow("⛏️ STEEL BASE", "steelBase"),
      ];
    case Page.Enemies:
      return [
        listRow("SPEED", "enemySpeed", S.factorSteps, factor),
        listRow("FIRE RATE", "enemyFireRate", S.factorSteps, factor),
        boolRow("TAKE POWER-UPS", "enemiesTakePowerUps", "YES", "NO"),
        listRow("PER LEVEL", "enemyCount", S.enemyCountSteps, auto),
        listRow("ON SCREEN", "enemiesOnScreen", S.onScreenSteps, auto),
        listRow("EXTRA ARMOR", "enemyArmor", range(0, 5), (v) => (v === 0 ? "0" : `+${v}`)),
        boolRow("UFO", "ufoEnabled"),
      ];
    case Page.Crazy:
      return [boolRow("🤪 CRAZY MODE", "crazyMode")];
  }
}

function makeLabel(text: string, fontName: string, fontSize: number, color: Color, position: Point): LabelNode {
  const node = new LabelNode(text, fontName);
  node.fontSize = fontSize;
  node.fontColor = color;
  node.position = position;
  return node;
}

/**
 * Cheat options (opened from the menu after the Konami code): pages of rows with < value > controls.
 * Keyboard: ↑↓ pick a row, ←→ change it, Tab / 1-4 switch pages, Esc goes back.
 */
export class CheatScene extends Scene {
  private page = Page.Player;
  private selectedRow = 0;
  private readonly pageNode = new Node();
  private statusLabel!: LabelNode;

  private get rowHeight(): number {
    return Math.min(46, (this.size.height * 0.48) / 5);
  }
  private get columnWidth(): number {
    return Math.min(this.size.width * 0.45, 400);
  }

  didMove(_view: View): void {
    this.backgroundColor = Colors.black;
    const { width, height } = this.size;
    this.addChild(makeLabel("CHEATS", "Helvetica-Bold", Math.min(40, height * 0.085), ACCENT, { x: width / 2, y: height * 0.87 }));
    this.statusLabel = makeLabel("", "Helvetica", Math.min(14, height * 0.033), Colors.gray, { x: width / 2, y: height * 0.695 });
    this.addChild(this.statusLabel);
    this.addChild(this.pageNode);

    const buttonHeight = Math.min(46, height * 0.1);
    const fontSize = Math.min(22, buttonHeight * 0.5);
    const back = createMenuButton("BACK", { x: width / 2 - 95, y: height * 0.08 }, 160, buttonHeight, fontSize);
    back.name = "backButton";
    this.addChild(back);
    const reset = createMenuButton("RESET ALL", { x: width / 2 + 95, y: height * 0.08 }, 160, buttonHeight, fontSize);
    reset.name = "resetButton";
    this.addChild(reset);

    this.rebuild();
  }

  /** Redraw tabs, rows and the status line (cheap enough to do on every change) */
  private rebuild(): void {
    this.pageNode.removeAllChildren();
    const { width, height } = this.size;
    const config = CheatSettings.config;

    // Tabs
    const tabWidth = Math.min(150, (width - 40) / PAGES.length - 8);
    const tabHeight = Math.min(36, height * 0.08);
    for (const p of PAGES) {
      const tab = ShapeNode.rect(tabWidth, tabHeight, 6);
      tab.position = { x: width / 2 + (p - (PAGES.length - 1) / 2) * (tabWidth + 8), y: height * 0.775 };
      tab.fillColor = p === this.page ? rgb(0.35, 0.1, 0.35) : ROW_FILL;
      tab.strokeColor = p === this.page ? ACCENT : Colors.gray;
      tab.lineWidth = 2;
      tab.name = `tab_${p}`;
      const lbl = makeLabel(PAGE_TITLES[p], "Helvetica-Bold", Math.min(17, tabHeight * 0.5), p === this.page ? Colors.white : Colors.lightGray, { x: 0, y: 0 });
      lbl.verticalAlignmentMode = "center";
      tab.addChild(lbl);
      this.pageNode.addChild(tab);
    }

    // Rows: two columns of up to 5 (the crazy page has one row in the middle)
    const rows = rowsFor(this.page);
    const crazy = this.page === Page.Crazy;
    const perColumn = crazy ? 1 : Math.ceil(rows.length / 2);
    const topY = height * 0.62;
    rows.forEach((row, index) => {
      const column = Math.floor(index / perColumn);
      const x = crazy ? width / 2 : column === 0 ? width * 0.27 : width * 0.73;
      const y = topY - (index % perColumn) * this.rowHeight;
      this.pageNode.addChild(this.makeRow(row, index, config, { x, y }));
    });

    if (crazy) {
      const lines = [
        "Every level: 10 to 1000 enemies of any kind, bosses and aliens too,",
        "several UFOs and a crowd of friends with 1 to 5 hits each.",
        "Every game start: 3 to 99 lives and random power-ups.",
        "Speeds, fire rates, armor, enemy power-ups and UFO switch still apply.",
      ];
      const fontSize = Math.min(16, height * 0.038);
      lines.forEach((line, i) => {
        this.pageNode.addChild(
          makeLabel(line, "Helvetica", fontSize, Colors.lightGray, { x: width / 2, y: topY - this.rowHeight * 1.3 - i * fontSize * 1.5 }),
        );
      });
    }

    // Status: do the cheats do anything right now?
    if (CheatSettings.isActive) {
      this.statusLabel.text = config.crazyMode ? "CRAZY MODE IS ON · high scores are not saved" : "Cheats are on · high scores are not saved";
      this.statusLabel.fontColor = Colors.yellow;
    } else {
      this.statusLabel.text = "Everything is normal: change something to cheat";
      this.statusLabel.fontColor = Colors.gray;
    }
  }

  private makeRow(row: Row, index: number, config: CheatConfig, position: Point): Node {
    const width = this.columnWidth;
    const height = this.rowHeight - 6;
    const container = new Node();
    container.position = position;
    container.name = `row_${index}`;

    const isSelected = index === this.selectedRow;
    const isChanged = row.value(config) !== row.value(defaultCheatConfig());
    const bg = ShapeNode.rect(width, height, 6);
    bg.fillColor = ROW_FILL;
    bg.strokeColor = isSelected ? ACCENT : white(0.35);
    bg.lineWidth = isSelected ? 2.5 : 1;
    container.addChild(bg);

    const fontSize = Math.min(18, height * 0.45);
    const title = makeLabel(row.title, "Helvetica-Bold", fontSize, Colors.white, { x: -width / 2 + 12, y: 0 });
    title.horizontalAlignmentMode = "left";
    title.verticalAlignmentMode = "center";
    container.addChild(title);

    // < value >
    const arrowWidth = height * 1.1;
    const decX = width / 2 - 125;
    const incX = width / 2 - arrowWidth / 2 - 6;
    for (const [name, text, x] of [[`dec_${index}`, "<", decX], [`inc_${index}`, ">", incX]] as [string, string, number][]) {
      const button = ShapeNode.rect(arrowWidth, height - 8, 4);
      button.position = { x, y: 0 };
      button.fillColor = white(0.28);
      button.strokeColor = Colors.gray;
      button.name = name;
      const lbl = makeLabel(text, "Helvetica-Bold", fontSize, Colors.white, { x: 0, y: 0 });
      lbl.verticalAlignmentMode = "center";
      button.addChild(lbl);
      container.addChild(button);
    }

    const value = makeLabel(row.value(config), "Helvetica-Bold", fontSize, isChanged ? Colors.yellow : Colors.lightGray, { x: (decX + incX) / 2, y: 0 });
    value.verticalAlignmentMode = "center";
    container.addChild(value);
    return container;
  }

  // MARK: - Actions

  private change(index: number, delta: number): void {
    const rows = rowsFor(this.page);
    if (index < 0 || index >= rows.length) return;
    const config = CheatSettings.config;
    rows[index].change(config, delta);
    CheatSettings.config = config;
    this.selectedRow = index;
    SoundManager.playShoot();
    this.rebuild();
  }

  private show(page: Page): void {
    this.page = page;
    this.selectedRow = 0;
    this.rebuild();
  }

  private goBack(): void {
    this.view?.present(new MenuScene(this.size), 0.3);
  }

  // MARK: - Input

  touchesBegan(touches: Touch[]): void {
    const touch = touches[0];
    if (!touch) return;
    // Most specific name first: an arrow button wins over its row
    const name = namedNodeAt(this, touch.location);
    if (!name) return;
    if (name === "backButton") return this.goBack();
    if (name === "resetButton") {
      CheatSettings.reset();
      SoundManager.playPowerUp();
      return this.rebuild();
    }
    const match = name.match(/^(dec|inc|tab|row)_(\d+)$/);
    if (!match) return;
    const i = Number(match[2]);
    switch (match[1]) {
      case "dec":
        return this.change(i, -1);
      case "inc":
      case "row": // Tap on a row (not on its arrows): next value
        return this.change(i, 1);
      case "tab":
        return this.show(i as Page);
    }
  }

  keyDown(code: string, _repeat: boolean): boolean {
    const count = rowsFor(this.page).length;
    switch (code) {
      case "Escape":
      case "Backspace":
        this.goBack();
        return true;
      case "ArrowUp":
      case "KeyW":
        this.selectedRow = (this.selectedRow - 1 + count) % count;
        this.rebuild();
        return true;
      case "ArrowDown":
      case "KeyS":
        this.selectedRow = (this.selectedRow + 1) % count;
        this.rebuild();
        return true;
      case "ArrowLeft":
      case "KeyA":
        this.change(this.selectedRow, -1);
        return true;
      case "ArrowRight":
      case "KeyD":
      case "Enter":
      case "Space":
        this.change(this.selectedRow, 1);
        return true;
      case "Tab":
        this.show(((this.page + 1) % PAGES.length) as Page);
        return true;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
        this.show((Number(code.slice(5)) - 1) as Page);
        return true;
    }
    return false;
  }
}
