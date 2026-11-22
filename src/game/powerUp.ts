import { Action } from "../engine/actions";
import { Colors, rgb, withAlpha, type Color } from "../engine/color";
import type { Point } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Path } from "../engine/path";
import { C } from "./constants";
import type { Tank } from "./tank";

export enum PowerUpType {
  Gun = "gun", // Ability to break steel walls
  Star = "star", // Shooting faster (stackable)
  Car = "car", // Tank becomes faster (stackable)
  Ship = "ship", // Tank can swim through water
  Shovel = "shovel", // Base surrounded by steel for 1 minute
  Saw = "saw", // Able to destroy forest/trees
  Tank = "tank", // Extra life
  Shield = "shield", // Shield for 1 minute
  Machinegun = "machinegun", // Multiple bullets
  Freeze = "freeze", // Freeze enemies
  Bomb = "bomb", // Explode all enemies
  Gold = "gold", // Gzhel-only: 99 points, enemies get major upgrade
  Laser = "laser", // Only dropped by the alien: shots of light pass through walls
  Magic = "magic", // Very rare: protects from the enemies' bomb and freeze
  Cheese = "cheese", // Once on the boss bonus stage (the rat's): 11 extra lives and an invincible base until the level ends
  // Level-clear bonuses (appear when the last enemy dies)
  Strawberry = "strawberry", // +50 points
  Banana = "banana", // +75 points
  Ball = "ball", // +90 points and faster start speed for the rest of the game
}

/** Level-clear bonus items: only players can pick them up */
export function isLevelBonus(type: PowerUpType): boolean {
  return type === PowerUpType.Strawberry || type === PowerUpType.Banana || type === PowerUpType.Ball;
}

export function colorForType(type: PowerUpType): Color {
  switch (type) {
    case PowerUpType.Gun:
      return rgb(0.8, 0.4, 0.0);
    case PowerUpType.Star:
      return rgb(1.0, 0.84, 0.0);
    case PowerUpType.Car:
      return rgb(0.0, 0.8, 0.0);
    case PowerUpType.Ship:
      return rgb(0.0, 0.5, 1.0);
    case PowerUpType.Shovel:
      return rgb(0.6, 0.4, 0.2);
    case PowerUpType.Saw:
      return rgb(0.5, 0.5, 0.5);
    case PowerUpType.Tank:
      return rgb(1.0, 0.4, 0.7);
    case PowerUpType.Shield:
      return rgb(0.0, 0.75, 1.0);
    case PowerUpType.Machinegun:
      return rgb(0.8, 0.0, 0.0);
    case PowerUpType.Freeze:
      return rgb(0.5, 0.8, 1.0);
    case PowerUpType.Bomb:
      return rgb(0.5, 0.0, 0.0);
    case PowerUpType.Gold:
      return rgb(1.0, 0.84, 0.0);
    case PowerUpType.Laser:
      return rgb(0.0, 0.85, 0.85);
    case PowerUpType.Magic:
      return rgb(0.55, 0.2, 0.85);
    case PowerUpType.Cheese:
      return rgb(1.0, 0.82, 0.2);
    case PowerUpType.Strawberry:
      return Colors.red;
    case PowerUpType.Banana:
      return Colors.yellow;
    case PowerUpType.Ball:
      return Colors.white;
  }
}

export function iconForType(type: PowerUpType): string {
  switch (type) {
    case PowerUpType.Gun:
      return "🔫";
    case PowerUpType.Star:
      return "⭐";
    case PowerUpType.Car:
      return "🚗";
    case PowerUpType.Ship:
      return "🚢";
    case PowerUpType.Shovel:
      return "⛏️";
    case PowerUpType.Saw:
      return "🪚";
    case PowerUpType.Tank:
      return "❤️";
    case PowerUpType.Shield:
      return "🛡️";
    case PowerUpType.Machinegun:
      return "💥";
    case PowerUpType.Freeze:
      return "❄️";
    case PowerUpType.Bomb:
      return "💣";
    case PowerUpType.Gold:
      return "$";
    case PowerUpType.Laser:
      return "🔦";
    case PowerUpType.Magic:
      return "🔮";
    case PowerUpType.Cheese:
      return "🧀";
    case PowerUpType.Strawberry:
      return "🍓";
    case PowerUpType.Banana:
      return "🍌";
    case PowerUpType.Ball:
      return "⚽";
  }
}

/** Power-up items that can be collected */
export class PowerUp extends Node {
  readonly type: PowerUpType;
  /** Question mark dropped by a defeated boss: a random power-up, revealed when picked up */
  readonly isMystery: boolean;
  private lifetime: number;
  private blinkTimer = 0;
  readonly size = { width: 28, height: 28 };

  /** Only players can take it (level-clear bonuses, the boss's question mark, magic, cheese), and the level waits for it */
  get isPlayersOnly(): boolean {
    return isLevelBonus(this.type) || this.isMystery || this.type === PowerUpType.Magic || this.type === PowerUpType.Cheese;
  }

  constructor(position: Point, type?: PowerUpType, mystery = false) {
    super();
    this.type = type ?? PowerUp.randomType();
    this.isMystery = mystery;
    // Level-clear bonuses, the question mark and the cheese stay until the level ends
    this.lifetime = isLevelBonus(this.type) || mystery || this.type === PowerUpType.Cheese ? Number.MAX_SAFE_INTEGER : C.powerUpLifetime;
    this.position = { ...position };
    this.zPosition = 8;
    this.drawPowerUp();
  }

  private drawPowerUp(): void {
    this.removeAllChildren();
    if (this.isMystery) {
      this.drawMystery();
    } else if (this.type === PowerUpType.Gold) {
      this.drawGoldBar();
    } else if (isLevelBonus(this.type)) {
      this.drawLevelBonus();
    } else if (this.type === PowerUpType.Cheese) {
      this.drawCheese();
    } else {
      const background = ShapeNode.rect(this.size.width, this.size.height, 4);
      background.fillColor = colorForType(this.type);
      background.strokeColor = Colors.white;
      background.lineWidth = 2;
      this.addChild(background);

      const icon = new LabelNode(iconForType(this.type));
      icon.fontSize = 16;
      icon.verticalAlignmentMode = "center";
      this.addChild(icon);
    }
  }

  /** Yellow cheese wedge with holes and a pulsing golden glow */
  private drawCheese(): void {
    const glow = ShapeNode.circle(17);
    glow.fillColor = rgb(1.0, 0.85, 0.2, 0.3);
    glow.strokeColor = Colors.clear;
    glow.zPosition = -1;
    this.addChild(glow);
    glow.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(1.0, 0.4), Action.fadeAlpha(0.4, 0.4)])));

    const rind = rgb(0.85, 0.6, 0.05);
    const body = new ShapeNode(new Path().moveTo(-12, -8).lineTo(12, -8).lineTo(12, 4).lineTo(-12, -1).close());
    body.fillColor = rgb(1.0, 0.82, 0.2);
    body.strokeColor = rind;
    body.lineWidth = 1.5;
    this.addChild(body);

    // Top face of the wedge
    const top = new ShapeNode(new Path().moveTo(-12, -1).lineTo(12, 4).lineTo(9, 9).close());
    top.fillColor = rgb(1.0, 0.92, 0.45);
    top.strokeColor = rind;
    top.lineWidth = 1.5;
    this.addChild(top);

    for (const [x, y, r] of [
      [-5, -4, 2.2],
      [3, -5, 1.6],
      [7, -1, 2.0],
      [0, -1, 1.2],
    ]) {
      const hole = ShapeNode.circle(r);
      hole.fillColor = rind;
      hole.strokeColor = Colors.clear;
      hole.position = { x, y };
      this.addChild(hole);
    }

    this.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.12, 0.4), Action.scaleTo(1.0, 0.4)])));
  }

  /** Lode Runner style gold bar */
  private drawGoldBar(): void {
    const goldColor = rgb(1.0, 0.84, 0.0);
    const darkGold = rgb(0.85, 0.65, 0.0);
    const lightGold = rgb(1.0, 0.95, 0.5);
    const barWidth = 24;
    const barHeight = 16;

    const bar = ShapeNode.rect(barWidth, barHeight, 2);
    bar.fillColor = goldColor;
    bar.strokeColor = darkGold;
    bar.lineWidth = 2;
    this.addChild(bar);

    const shine = ShapeNode.rect(barWidth - 6, 4);
    shine.fillColor = lightGold;
    shine.strokeColor = Colors.clear;
    shine.position = { x: 0, y: 4 };
    this.addChild(shine);

    const symbol = new LabelNode("$", "Helvetica-Bold");
    symbol.fontSize = 12;
    symbol.fontColor = darkGold;
    symbol.verticalAlignmentMode = "center";
    symbol.position = { x: 0, y: -1 };
    this.addChild(symbol);

    this.addSparkle();
  }

  /** Boss drop: purple box with a big pulsing question mark */
  private drawMystery(): void {
    const background = ShapeNode.rect(this.size.width, this.size.height, 4);
    background.fillColor = rgb(0.45, 0.1, 0.75);
    background.strokeColor = Colors.white;
    background.lineWidth = 2;
    this.addChild(background);

    const mark = new LabelNode("?", "Helvetica-Bold");
    mark.fontSize = 22;
    mark.fontColor = Colors.yellow;
    mark.verticalAlignmentMode = "center";
    this.addChild(mark);
    mark.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.25, 0.4), Action.scaleTo(0.9, 0.4)])));
    background.run(
      Action.repeatForever(
        Action.sequence([
          Action.run(() => (background.strokeColor = Colors.yellow)),
          Action.wait(0.25),
          Action.run(() => (background.strokeColor = Colors.white)),
          Action.wait(0.25),
        ]),
      ),
    );
  }

  /** Fruit / soccer ball: no box, a soft glow and a gentle bounce */
  private drawLevelBonus(): void {
    let glowColor: Color;
    let iconSize: number;
    switch (this.type) {
      case PowerUpType.Strawberry:
        glowColor = Colors.red;
        iconSize = 16;
        break;
      case PowerUpType.Banana:
        glowColor = Colors.yellow;
        iconSize = 22;
        break;
      default:
        glowColor = Colors.white;
        iconSize = 22;
    }

    const glow = ShapeNode.circle(14);
    glow.fillColor = withAlpha(glowColor, 0.25);
    glow.strokeColor = withAlpha(glowColor, 0.6);
    glow.lineWidth = 1.5;
    this.addChild(glow);
    glow.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.2, 0.5), Action.scaleTo(0.9, 0.5)])));

    const label = new LabelNode(iconForType(this.type));
    label.fontSize = iconSize;
    label.verticalAlignmentMode = "center";
    this.addChild(label);
    label.run(Action.repeatForever(Action.sequence([Action.moveBy(0, 3, 0.3), Action.moveBy(0, -3, 0.3)])));
    if (this.type === PowerUpType.Ball) {
      label.run(Action.repeatForever(Action.rotateBy(-Math.PI * 2, 1.2)));
    }
  }

  private addSparkle(): void {
    const sparkle = ShapeNode.circle(3);
    sparkle.fillColor = Colors.white;
    sparkle.strokeColor = Colors.clear;
    sparkle.alpha = 0;
    sparkle.position = { x: 8, y: 5 };
    sparkle.name = "sparkle";
    this.addChild(sparkle);

    const fadeIn = Action.fadeAlpha(1, 0.3);
    const fadeOut = Action.fadeAlpha(0, 0.3);
    const wait = Action.wait(1.0);
    sparkle.run(
      Action.repeatForever(
        Action.sequence([fadeIn, fadeOut, wait, Action.moveTo({ x: -6, y: -3 }, 0), fadeIn, fadeOut, wait, Action.moveTo({ x: 8, y: 5 }, 0)]),
      ),
    );
  }

  get iconForType(): string {
    return iconForType(this.type);
  }

  /** Returns true when expired */
  update(): boolean {
    this.lifetime -= 1;
    // Blink for the last 3 seconds
    if (this.lifetime < 180) {
      this.blinkTimer += 1;
      this.isHidden = Math.floor(this.blinkTimer / 10) % 2 === 0;
    }
    return this.lifetime <= 0;
  }

  applyTo(tank: Tank): void {
    switch (this.type) {
      case PowerUpType.Gun:
        tank.bulletPower = 2; // Can break steel
        break;
      case PowerUpType.Star:
        tank.starCount = Math.min(tank.starCount + 1, 3);
        break;
      case PowerUpType.Car:
        tank.speedMultiplier = Math.min(tank.speedMultiplier + 0.3, 2.5);
        break;
      case PowerUpType.Ship:
        tank.activateShip();
        break;
      case PowerUpType.Saw:
        tank.canDestroyTrees = true;
        break;
      case PowerUpType.Tank:
        tank.lives += 1;
        break;
      case PowerUpType.Shield:
        tank.activateShield(C.shieldDuration);
        break;
      case PowerUpType.Machinegun:
        tank.machinegunCount = Math.min(tank.machinegunCount + 1, 3);
        break;
      case PowerUpType.Laser:
        tank.laserRounds = C.laserRoundsOnPickup;
        break;
      case PowerUpType.Magic:
        tank.hasMagic = true;
        break;
      case PowerUpType.Cheese:
        tank.addLives(C.cheeseLivesBonus); // The invincible base is handled by the game scene
        break;
      case PowerUpType.Ball:
        tank.addBallSpeedBoost();
        break;
      default:
        // Shovel, freeze, bomb, gold, fruit: handled by the game scene
        break;
    }
  }

  /** Weighted random selection - some power-ups are rarer */
  static randomType(): PowerUpType {
    const r = Math.random();
    if (r < 0.14) return PowerUpType.Star;
    if (r < 0.27) return PowerUpType.Car;
    if (r < 0.37) return PowerUpType.Gun;
    if (r < 0.46) return PowerUpType.Shield;
    if (r < 0.55) return PowerUpType.Tank;
    if (r < 0.64) return PowerUpType.Freeze;
    if (r < 0.73) return PowerUpType.Bomb;
    if (r < 0.8) return PowerUpType.Ship;
    if (r < 0.87) return PowerUpType.Saw;
    if (r < 0.94) return PowerUpType.Shovel;
    return PowerUpType.Machinegun;
  }
}
