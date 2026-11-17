import { Colors, hsb, rgb, type Color } from "../engine/color";
import { LabelNode, Node, ShapeNode, SpriteNode, makeTexture, type Texture } from "../engine/node";
import { Path } from "../engine/path";
import { C } from "./constants";
import { GameSettings, tankColorOf } from "./settings";

const SIDEBAR_WIDTH = C.sidebarWidth;
const BACKGROUND_COLOR = rgb(0.39, 0.39, 0.39);
const PLAYER_ICON_COLOR = rgb(1.0, 0.7, 0.0);
const TEXT_COLOR = Colors.black;

const ENEMY_ICON_SIZE = 18;
const ENEMY_ICON_SPACING = 6;
const ENEMY_COLUMNS = 2;
const SECTION_PADDING = 10;

// Fixed Y positions (from the top)
const ENEMY_SECTION_Y = 10;
const PLAYER_SECTION_Y = 400;
const POWERUP_SECTION_Y = 480;
const FLAG_SECTION_Y = 710;

// Two-player layout: each player gets a block with lives and their own power-ups below
const PLAYER2_BLOCK_OFFSET = 160;
const TWO_PLAYER_POWERUP_GAP = 52;
const TWO_PLAYER_LINE_HEIGHT = 14;
const TWO_PLAYER_FLAG_SECTION_Y = 745;

let enemyIconTexture: Texture | null = null;

function getEnemyIconTexture(size: number): Texture {
  if (enemyIconTexture) return enemyIconTexture;
  enemyIconTexture = makeTexture(size, size, (ctx) => {
    ctx.fillStyle = "#000";
    const center = size / 2;
    const bodyWidth = size * 0.7;
    const bodyHeight = size * 0.6;
    ctx.fillRect(center - bodyWidth / 2, center - bodyHeight / 2 + size * 0.1, bodyWidth, bodyHeight);
    const trackWidth = size * 0.2;
    const trackHeight = size * 0.7;
    ctx.fillRect(center - size * 0.35 - trackWidth / 2, center - trackHeight / 2 + size * 0.05, trackWidth, trackHeight);
    ctx.fillRect(center + size * 0.35 - trackWidth / 2, center - trackHeight / 2 + size * 0.05, trackWidth, trackHeight);
    const barrelWidth = size * 0.2;
    const barrelHeight = size * 0.4;
    ctx.fillRect(center - barrelWidth / 2, center - size * 0.3 - barrelHeight / 2, barrelWidth, barrelHeight);
  });
  return enemyIconTexture;
}

/** Seeded random (same flag colors for the same level every time) */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Power-up data for the sidebar */
export interface PowerUpData {
  starCount: number;
  bossFireBoost: number;
  machinegunCount: number;
  hasGun: boolean;
  hasShip: boolean;
  hasSaw: boolean;
  speedBoosts: number;
  ballBoosts: number;
  hasLaser: boolean;
  hasMagic: boolean;
  /** Gzhel friend's remaining hits (0 = no friend on the field) */
  friendHits: number;
}

export function emptyPowerUpData(): PowerUpData {
  return {
    starCount: 0,
    bossFireBoost: 0,
    machinegunCount: 0,
    hasGun: false,
    hasShip: false,
    hasSaw: false,
    speedBoosts: 0,
    ballBoosts: 0,
    hasLaser: false,
    hasMagic: false,
    friendHits: 0,
  };
}

function samePowerUps(a: PowerUpData | null, b: PowerUpData): boolean {
  if (!a) return false;
  return (Object.keys(b) as (keyof PowerUpData)[]).every((k) => a[k] === b[k]);
}

function rect(width: number, height: number, color: Color): ShapeNode {
  const node = ShapeNode.rect(width, height);
  node.fillColor = color;
  node.strokeColor = Colors.clear;
  return node;
}

/** Sidebar like in the original Battle City: remaining enemies, lives, power-ups, level flag */
export class Sidebar extends Node {
  private readonly enemyIconsNode = new Node();
  private readonly playerInfoNode = new Node();
  private readonly powerUpNode = new Node();
  private readonly flagNode = new Node();
  private readonly levelLabel: LabelNode;

  private lastEnemyCount = -1;
  private lastPlayerLives = -1;
  private lastPlayer2Lives = -1;
  private lastLevel = -1;
  private lastPowerUps: PowerUpData | null = null;
  private lastPowerUps2: PowerUpData | null = null;

  constructor(
    sidebarHeight: number,
    /** Two-player game: lives for both players and power-ups in two blocks */
    private readonly twoPlayers = false,
  ) {
    super();
    const background = rect(SIDEBAR_WIDTH, sidebarHeight, BACKGROUND_COLOR);
    background.position = { x: SIDEBAR_WIDTH / 2, y: sidebarHeight / 2 };
    this.addChild(background);

    this.enemyIconsNode.position = { x: SECTION_PADDING, y: sidebarHeight - ENEMY_SECTION_Y };
    this.addChild(this.enemyIconsNode);

    this.playerInfoNode.position = { x: SECTION_PADDING, y: sidebarHeight - PLAYER_SECTION_Y };
    this.addChild(this.playerInfoNode);

    const powerUpTop = twoPlayers ? PLAYER_SECTION_Y + TWO_PLAYER_POWERUP_GAP : POWERUP_SECTION_Y;
    this.powerUpNode.position = { x: SECTION_PADDING, y: sidebarHeight - powerUpTop };
    this.addChild(this.powerUpNode);

    const flagY = twoPlayers ? TWO_PLAYER_FLAG_SECTION_Y : FLAG_SECTION_Y;
    this.flagNode.position = { x: SECTION_PADDING, y: sidebarHeight - flagY };
    this.addChild(this.flagNode);

    const pole = rect(3, 40, Colors.black);
    pole.position = { x: 11.5, y: -20 };
    this.flagNode.addChild(pole);

    this.levelLabel = new LabelNode("1", "Helvetica-Bold");
    this.levelLabel.fontSize = 20;
    this.levelLabel.fontColor = TEXT_COLOR;
    this.levelLabel.horizontalAlignmentMode = "left";
    this.levelLabel.position = { x: 5, y: -65 };
    this.flagNode.addChild(this.levelLabel);
  }

  /** Update the display (only rebuilds what changed) */
  update(
    remainingEnemies: number,
    playerLives: number,
    player2Lives: number,
    level: number,
    powerUps: PowerUpData = emptyPowerUpData(),
    powerUps2: PowerUpData = emptyPowerUpData(),
  ): void {
    if (remainingEnemies !== this.lastEnemyCount) {
      this.lastEnemyCount = remainingEnemies;
      this.updateEnemyIcons(remainingEnemies);
    }
    if (playerLives !== this.lastPlayerLives || (this.twoPlayers && player2Lives !== this.lastPlayer2Lives)) {
      this.lastPlayerLives = playerLives;
      this.lastPlayer2Lives = player2Lives;
      this.updatePlayerInfo(playerLives, player2Lives);
    }
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.updateFlag(level);
    }
    if (!samePowerUps(this.lastPowerUps, powerUps) || (this.twoPlayers && !samePowerUps(this.lastPowerUps2, powerUps2))) {
      this.lastPowerUps = { ...powerUps };
      this.lastPowerUps2 = { ...powerUps2 };
      this.updatePowerUps(powerUps, this.twoPlayers ? powerUps2 : null);
    }
  }

  private updatePowerUps(data: PowerUpData, data2: PowerUpData | null): void {
    this.powerUpNode.removeAllChildren();
    let lineHeight = 16;
    let yOffset: number;
    if (data2) {
      lineHeight = TWO_PLAYER_LINE_HEIGHT;
      this.addPowerUpRows(data, 0, 0, 12, 11, lineHeight);
      this.addPowerUpRows(data2, 0, -PLAYER2_BLOCK_OFFSET, 12, 11, lineHeight);
      // Friend goes below the IIP block (fixed spot)
      yOffset = -PLAYER2_BLOCK_OFFSET - 7 * lineHeight - 6;
    } else {
      yOffset = this.addPowerUpRows(data, 0, 0, 12, 11, lineHeight);
    }

    if (data.friendHits > 0) {
      yOffset -= 4;
      const title = new LabelNode("FRIEND", "Helvetica-Bold");
      title.fontSize = 10;
      title.fontColor = rgb(0.35, 0.6, 1.0);
      title.horizontalAlignmentMode = "left";
      title.verticalAlignmentMode = "center";
      title.position = { x: 0, y: yOffset };
      this.powerUpNode.addChild(title);
      yOffset -= lineHeight;
      const row = this.createPowerUpRow("💙", `x${data.friendHits}`, 12);
      row.position = { x: 0, y: yOffset };
      this.powerUpNode.addChild(row);
    }
  }

  /** One player's power-up rows; returns the next free Y */
  private addPowerUpRows(data: PowerUpData, x: number, y: number, iconSize: number, fontSize: number, lineHeight: number): number {
    const rows: [string, string][] = [];
    if (data.starCount > 0) rows.push(["⭐", `x${data.starCount}`]);
    if (data.bossFireBoost > 0) rows.push(["🔥", `x${data.bossFireBoost}`]);
    if (data.machinegunCount > 0) rows.push(["💥", `x${data.machinegunCount}`]);
    if (data.hasGun) rows.push(["🔫", ""]);
    if (data.hasShip) rows.push(["🚢", ""]);
    if (data.hasSaw) rows.push(["🪚", ""]);
    if (data.hasLaser) rows.push(["🔦", ""]);
    if (data.hasMagic) rows.push(["🔮", ""]);
    if (data.speedBoosts > 0) rows.push(["🚗", `x${data.speedBoosts}`]);
    if (data.ballBoosts > 0) rows.push(["⚽", `x${data.ballBoosts}`]);

    let yOffset = y;
    for (const [icon, label] of rows) {
      const node = this.createPowerUpRow(icon, label, iconSize, fontSize);
      node.position = { x, y: yOffset };
      this.powerUpNode.addChild(node);
      yOffset -= lineHeight;
    }
    return yOffset;
  }

  private createPowerUpRow(icon: string, label: string, iconSize: number, fontSize = 11): Node {
    const container = new Node();
    const iconLabel = new LabelNode(icon);
    iconLabel.fontSize = iconSize;
    iconLabel.horizontalAlignmentMode = "left";
    iconLabel.verticalAlignmentMode = "center";
    container.addChild(iconLabel);
    if (label) {
      const text = new LabelNode(label, "Helvetica-Bold");
      text.fontSize = fontSize;
      text.fontColor = TEXT_COLOR;
      text.horizontalAlignmentMode = "left";
      text.verticalAlignmentMode = "center";
      text.position = { x: iconSize + (fontSize < 11 ? 2 : 4), y: 0 };
      container.addChild(text);
    }
    return container;
  }

  private updateEnemyIcons(count: number): void {
    this.enemyIconsNode.removeAllChildren();
    const texture = getEnemyIconTexture(ENEMY_ICON_SIZE);

    // Only so many rows fit above the lives section: the last row shows "+N" when there are more
    const step = ENEMY_ICON_SIZE + ENEMY_ICON_SPACING;
    const maxRows = Math.trunc((PLAYER_SECTION_Y - ENEMY_SECTION_Y - 20) / step);
    const maxIcons = maxRows * ENEMY_COLUMNS;
    const shown = count > maxIcons ? maxIcons - ENEMY_COLUMNS : count;
    if (shown < count) {
      const more = new LabelNode(`+${count - shown}`, "Helvetica-Bold");
      more.fontSize = 13;
      more.fontColor = TEXT_COLOR;
      more.horizontalAlignmentMode = "left";
      more.verticalAlignmentMode = "center";
      more.position = { x: 0, y: -(maxRows - 1) * step - ENEMY_ICON_SIZE / 2 };
      this.enemyIconsNode.addChild(more);
    }
    for (let i = 0; i < shown; i++) {
      const col = i % ENEMY_COLUMNS;
      const row = Math.floor(i / ENEMY_COLUMNS);
      const icon = new SpriteNode(texture, Colors.white, { width: ENEMY_ICON_SIZE, height: ENEMY_ICON_SIZE });
      icon.position = { x: col * step + ENEMY_ICON_SIZE / 2, y: -row * step - ENEMY_ICON_SIZE / 2 };
      this.enemyIconsNode.addChild(icon);
    }
  }

  private updatePlayerInfo(lives: number, player2Lives: number): void {
    this.playerInfoNode.removeAllChildren();
    this.addPlayerLivesSection("IP", lives, tankColorOf(GameSettings.playerTankColor), 0);
    if (this.twoPlayers) {
      this.addPlayerLivesSection("IIP", player2Lives, tankColorOf(GameSettings.player2TankColor), -PLAYER2_BLOCK_OFFSET);
      const width = SIDEBAR_WIDTH - SECTION_PADDING * 2;
      const divider = rect(width, 2, TEXT_COLOR);
      divider.position = { x: width / 2, y: -PLAYER2_BLOCK_OFFSET + 12 };
      this.playerInfoNode.addChild(divider);
    }
  }

  /** "IP" / "IIP" title, small tank icon and remaining lives */
  private addPlayerLivesSection(title: string, lives: number, tankColor: Color, y: number): void {
    const ipLabel = new LabelNode(title, "Helvetica-Bold");
    ipLabel.fontSize = 12;
    ipLabel.fontColor = PLAYER_ICON_COLOR;
    ipLabel.horizontalAlignmentMode = "left";
    ipLabel.position = { x: 0, y };
    this.playerInfoNode.addChild(ipLabel);

    const tankIcon = Sidebar.createPlayerTankIcon(20, tankColor);
    tankIcon.position = { x: 10, y: y - 25 };
    this.playerInfoNode.addChild(tankIcon);

    // Lives count (lives - 1, like the original)
    const livesLabel = new LabelNode(`${Math.max(0, lives - 1)}`, "Helvetica-Bold");
    livesLabel.fontSize = 14;
    livesLabel.fontColor = TEXT_COLOR;
    livesLabel.horizontalAlignmentMode = "right";
    livesLabel.position = { x: SIDEBAR_WIDTH - SECTION_PADDING * 2, y: y - 18 };
    this.playerInfoNode.addChild(livesLabel);
  }

  static createPlayerTankIcon(size: number, tankColor: Color): Node {
    const container = new Node();
    const body = rect(size * 0.6, size * 0.5, tankColor);
    body.position = { x: 0, y: -size * 0.1 };
    container.addChild(body);
    for (const x of [-size * 0.35, size * 0.35]) {
      const track = rect(size * 0.15, size * 0.6, tankColor);
      track.position = { x, y: 0 };
      container.addChild(track);
    }
    const barrel = rect(size * 0.15, size * 0.45, tankColor);
    barrel.position = { x: 0, y: size * 0.3 };
    container.addChild(barrel);
    return container;
  }

  private updateFlag(level: number): void {
    for (const child of this.flagNode.children.filter((c) => c.name === "flagShape")) child.removeFromParent();
    const colorCount = level % 100 === 0 && level > 0 ? 3 : level % 10 === 0 && level > 0 ? 2 : 1;

    // Seeded with the level: the same flag every time
    const random = seededRandom(level * 12345);
    const colors: Color[] = [];
    for (let i = 0; i < colorCount; i++) {
      const hue = random();
      const saturation = 0.7 + random() * 0.3;
      const brightness = 0.7 + random() * 0.3;
      colors.push(hsb(hue, saturation, brightness));
    }

    const flag = new Node();
    const width = 17;
    const height = 18;
    const stripeHeight = height / colors.length;
    colors.forEach((color, i) => {
      // Triangular pennant, one stripe per color
      const y0 = -i * stripeHeight;
      const y1 = -(i + 1) * stripeHeight;
      const rightTop = width * (1 - i / colors.length);
      const rightBottom = width * (1 - (i + 1) / colors.length);
      const stripe = new ShapeNode(new Path().moveTo(0, y0).lineTo(rightTop, y0).lineTo(rightBottom, y1).lineTo(0, y1).close());
      stripe.fillColor = color;
      stripe.strokeColor = Colors.clear;
      flag.addChild(stripe);
    });
    flag.position = { x: 13, y: -3 };
    flag.name = "flagShape";
    this.flagNode.addChild(flag);

    this.levelLabel.text = `${level}`;
  }
}
