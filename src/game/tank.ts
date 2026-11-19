import { Action } from "../engine/actions";
import { Colors, darker, hex, hsb, rgb, white, withAlpha, type Color } from "../engine/color";
import { fill, fillEllipse, fillPolygon, flipY, stroke, strokeEllipse, strokeLines } from "../engine/draw";
import { randomIn, type Point, type Size } from "../engine/geometry";
import { LabelNode, Node, ShapeNode, SpriteNode, makeTexture, type Texture } from "../engine/node";
import { Path } from "../engine/path";
import { Bullet, Burst } from "./bullet";
import { C, EnemyType, spawnPosition } from "./constants";
import { Direction, rotation, velocity } from "./direction";
import type { GameMap } from "./map";
import { Tile } from "./map";
import { GameSettings, tankColorOf } from "./settings";
import { GameState } from "./state";
import { TankAI } from "./tankAI";

const RAINBOW_FRAME_COUNT = 30; // 30 hue steps for smooth animation
/** Last 1.5 seconds of a shield: 3 flashes warn that it is about to end */
const SHIELD_WARNING_FRAMES = 90;

const rainbowTextureCache = new Map<string, Texture[][]>();
const alienTextureCache = new Map<number, Texture[]>();
const explosionTextureCache = new Map<string, Texture>();

function explosionTexture(color: Color, radius: number, key: string): Texture {
  let texture = explosionTextureCache.get(key);
  if (!texture) {
    const size = radius * 2;
    texture = makeTexture(size, size, (ctx) => {
      fill(ctx, color);
      fillEllipse(ctx, 0, 0, size, size);
    });
    explosionTextureCache.set(key, texture);
  }
  return texture;
}

/** Small green alien with a ray gun, facing up (sprite is rotated by direction) */
function alienTextures(size: number): Texture[] {
  const key = Math.trunc(size);
  const cached = alienTextureCache.get(key);
  if (cached) return cached;

  const k = size / 22; // Drawn on a 22pt grid
  const green = rgb(0.4, 0.9, 0.4);
  const darkGreen = rgb(0.2, 0.6, 0.2);
  const frames: Texture[] = [];
  for (let frame = 0; frame < 2; frame++) {
    const step = frame === 0 ? 1 : -1; // Legs/arms swing
    frames.push(
      makeTexture(size, size, (ctx) => {
        flipY(ctx, size);
        ctx.scale(k, k);
        ctx.lineCap = "round";

        // Legs
        stroke(ctx, darkGreen, 2);
        strokeLines(ctx, [
          [9, 4, 8 - step, 1],
          [13, 4, 14 - step, 1],
        ]);
        // Arms (right arm holds the ray gun)
        stroke(ctx, green);
        strokeLines(ctx, [
          [8, 8, 4, 9 + step],
          [14, 8, 16, 10],
        ]);
        // Ray gun pointing forward (up)
        fill(ctx, Colors.gray);
        ctx.fillRect(15.5, 9, 2, 7);
        fill(ctx, Colors.cyan);
        ctx.fillRect(15.5, 15.5, 2, 1.5);
        // Body
        fill(ctx, green);
        fillEllipse(ctx, 7.5, 3, 7, 8);
        stroke(ctx, darkGreen, 0.8);
        strokeEllipse(ctx, 7.5, 3, 7, 8);
        // Antennae with yellow tips
        stroke(ctx, green, 1.2);
        strokeLines(ctx, [
          [9, 18, 7, 20.5],
          [13, 18, 15, 20.5],
        ]);
        fill(ctx, Colors.yellow);
        fillEllipse(ctx, 5.8, 19.8, 2.4, 2.2);
        fillEllipse(ctx, 13.8, 19.8, 2.4, 2.2);
        // Big head
        fill(ctx, green);
        fillEllipse(ctx, 4.5, 10, 13, 9);
        stroke(ctx, darkGreen, 0.8);
        strokeEllipse(ctx, 4.5, 10, 13, 9);
        // Big black eyes with shine
        fill(ctx, Colors.black);
        fillEllipse(ctx, 6.5, 12.5, 3.5, 4.5);
        fillEllipse(ctx, 12, 12.5, 3.5, 4.5);
        fill(ctx, Colors.white);
        fillEllipse(ctx, 7.3, 15, 1.2, 1.2);
        fillEllipse(ctx, 12.8, 15, 1.2, 1.2);
      }),
    );
  }
  alienTextureCache.set(key, frames);
  return frames;
}

/** Tank drawn into a texture (y up inside, like SpriteKit) */
function renderTankTexture(size: number, mainColor: Color, darkColor: Color, isPlayer: boolean, enemyType: EnemyType, trackOffset = 0): Texture {
  if (!isPlayer && GameState.isBirdStage && enemyType !== EnemyType.Gzhel && enemyType !== EnemyType.Alien) {
    return renderBirdTexture(size, mainColor, darkColor, enemyType, trackOffset > 0);
  }
  const scale = size / C.tankSize;
  return makeTexture(size, size, (ctx) => {
    const center = size / 2;
    flipY(ctx, size);

    // Tracks
    const trackWidth = 6 * scale;
    fill(ctx, darkColor);
    ctx.fillRect(0, 0, trackWidth, size);
    ctx.fillRect(size - trackWidth, 0, trackWidth, size);

    // Track treads (animated)
    fill(ctx, rgb(0.2, 0.2, 0.2));
    const treadSpacing = 4 * scale;
    const treadHeight = 2 * scale;
    const numTreads = Math.trunc(size / treadSpacing) + 2;
    for (let i = 0; i < numTreads; i++) {
      const baseY = i * treadSpacing + trackOffset;
      const y = (baseY % (size + treadSpacing)) - treadSpacing;
      if (y >= 0 && y <= size) {
        ctx.fillRect(1 * scale, y, trackWidth - 2 * scale, treadHeight);
        ctx.fillRect(size - trackWidth + 1 * scale, y, trackWidth - 2 * scale, treadHeight);
      }
    }

    // Hull
    const hullLeft = trackWidth;
    const hullRight = size - trackWidth;
    const hullWidth = hullRight - hullLeft;
    const hullBottom = 2 * scale;
    const hullTop = size - 2 * scale;
    fill(ctx, mainColor);
    ctx.fillRect(hullLeft, hullBottom, hullWidth, hullTop - hullBottom);
    stroke(ctx, darkColor, 1 * scale);
    ctx.strokeRect(hullLeft, hullBottom, hullWidth, hullTop - hullBottom);

    // Turret
    const turretRadius = 6 * scale;
    const turretCenterY = center - 1 * scale;
    fill(ctx, mainColor);
    fillEllipse(ctx, center - turretRadius, turretCenterY - turretRadius, turretRadius * 2, turretRadius * 2);
    stroke(ctx, darkColor, 1.5 * scale);
    strokeEllipse(ctx, center - turretRadius, turretCenterY - turretRadius, turretRadius * 2, turretRadius * 2);

    // Gun barrel
    const barrelWidth = 4 * scale;
    const barrelLength = size / 2 + 2 * scale;
    const barrelStartY = turretCenterY + turretRadius - 2 * scale;
    fill(ctx, darkColor);
    ctx.fillRect(center - barrelWidth / 2, barrelStartY, barrelWidth, barrelLength);
    fill(ctx, darker(mainColor, 0.1));
    ctx.fillRect(center - barrelWidth / 2 + 1 * scale, barrelStartY, barrelWidth - 2 * scale, barrelLength - 2 * scale);

    // Enemy type markings
    if (!isPlayer) {
      switch (enemyType) {
        case EnemyType.Fast:
          fill(ctx, withAlpha(Colors.white, 0.5));
          ctx.fillRect(center - 1 * scale, hullBottom + 3 * scale, 2 * scale, 6 * scale);
          break;
        case EnemyType.Armored:
          fill(ctx, Colors.gray);
          ctx.fillRect(hullLeft + 1 * scale, center - 3 * scale, 2 * scale, 6 * scale);
          ctx.fillRect(hullRight - 3 * scale, center - 3 * scale, 2 * scale, 6 * scale);
          break;
        case EnemyType.Heavy:
          fill(ctx, withAlpha(Colors.white, 0.4));
          ctx.fillRect(center - 4 * scale, turretCenterY - 0.5 * scale, 8 * scale, 1 * scale);
          ctx.fillRect(center - 0.5 * scale, turretCenterY - 4 * scale, 1 * scale, 8 * scale);
          break;
        case EnemyType.Boss: {
          // Skull over the turret (top of the skull faces the barrel)
          const bone = white(0.96);
          const hole = white(0.05);
          const cy = turretCenterY - 0.5 * scale;
          fill(ctx, bone);
          fillEllipse(ctx, center - 5.5 * scale, cy - 2.5 * scale, 11 * scale, 10 * scale);
          ctx.fillRect(center - 3.5 * scale, cy - 5 * scale, 7 * scale, 4 * scale);
          fill(ctx, hole);
          fillEllipse(ctx, center - 4.2 * scale, cy + 0.3 * scale, 3.4 * scale, 3.6 * scale);
          fillEllipse(ctx, center + 0.8 * scale, cy + 0.3 * scale, 3.4 * scale, 3.6 * scale);
          fillPolygon(ctx, [
            [center, cy + 0.2 * scale],
            [center - 1 * scale, cy - 1.6 * scale],
            [center + 1 * scale, cy - 1.6 * scale],
          ]);
          stroke(ctx, hole, 0.6 * scale);
          strokeLines(
            ctx,
            [-1.75, 0, 1.75].map((dx) => [center + dx * scale, cy - 5 * scale, center + dx * scale, cy - 2.6 * scale]),
          );
          break;
        }
        case EnemyType.Gzhel: {
          // Cobalt-blue Gzhel ornament on white porcelain
          const cobalt = rgb(0.0, 0.28, 0.67);
          const lightBlue = rgb(0.4, 0.6, 0.9);
          fill(ctx, cobalt);
          for (let i = 0; i < 5; i++) {
            const angle = (i * 2 * Math.PI) / 5;
            const px = center + Math.cos(angle) * 3 * scale;
            const py = turretCenterY + Math.sin(angle) * 3 * scale;
            fillEllipse(ctx, px - 1.4 * scale, py - 1.4 * scale, 2.8 * scale, 2.8 * scale);
          }
          fill(ctx, lightBlue);
          fillEllipse(ctx, center - 1 * scale, turretCenterY - 1 * scale, 2 * scale, 2 * scale);
          fill(ctx, cobalt);
          for (const [dx, dy] of [
            [hullLeft + 2.5 * scale, hullBottom + 2.5 * scale],
            [hullRight - 2.5 * scale, hullBottom + 2.5 * scale],
            [hullLeft + 2.5 * scale, hullTop - 2.5 * scale],
            [hullRight - 2.5 * scale, hullTop - 2.5 * scale],
          ]) {
            fillEllipse(ctx, dx - 1.2 * scale, dy - 1.2 * scale, 2.4 * scale, 2.4 * scale);
          }
          stroke(ctx, lightBlue, 1 * scale);
          ctx.beginPath();
          ctx.moveTo(center - 4 * scale, hullBottom + 3 * scale);
          ctx.quadraticCurveTo(center, hullBottom + 7 * scale, center + 4 * scale, hullBottom + 3 * scale);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
    } else {
      // Player star
      fill(ctx, withAlpha(Colors.white, 0.5));
      fillEllipse(ctx, center - 2 * scale, hullBottom + 3 * scale, 4 * scale, 4 * scale);
    }
  });
}

/**
 * Gorodets painted bird seen from above, beak pointing up (the sprite is rotated by direction).
 * Two frames: wings spread and wings raised, swapped while moving like the tank tracks.
 */
function renderBirdTexture(size: number, mainColor: Color, darkColor: Color, enemyType: EnemyType, wingsUp: boolean): Texture {
  const k = size / C.tankSize;
  return makeTexture(size, size, (ctx) => {
    flipY(ctx, size);
    ctx.scale(k, k);
    ctx.lineCap = "round";
    const c = 14;
    const whiteC = white(1, 0.9);
    const gold = rgb(1.0, 0.78, 0.2);
    const green = rgb(0.15, 0.55, 0.25);

    // Tail: a fan of feathers behind the body, colors alternating
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i - 2) * 0.32;
      ctx.save();
      ctx.translate(c, 9);
      ctx.rotate(angle);
      fill(ctx, i % 2 === 0 ? darkColor : green);
      fillEllipse(ctx, 0, -2, 9.5, 4);
      stroke(ctx, whiteC, 0.6);
      strokeLines(ctx, [[3, 0, 8.5, 0]]);
      ctx.restore();
    }

    // Wings: spread out to the sides, or raised forward for the flap
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(c + side * 4, 14);
      ctx.rotate(side * (wingsUp ? 0.9 : 0.25));
      fill(ctx, darkColor);
      fillEllipse(ctx, side < 0 ? -11 : 0, -3.5, 11, 7);
      stroke(ctx, whiteC, 0.7);
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        const x = side * (3 + j * 2.6);
        ctx.moveTo(x, -2);
        ctx.quadraticCurveTo(x + side * 1.6, 0, x + side * 1.4, 2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Body
    fill(ctx, mainColor);
    fillEllipse(ctx, c - 6, 6, 12, 15);
    stroke(ctx, darkColor, 1);
    strokeEllipse(ctx, c - 6, 6, 12, 15);
    // Breast ornament: white scallops
    stroke(ctx, whiteC, 0.7);
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const y = 9 + j * 3;
      ctx.moveTo(c - 3, y);
      ctx.quadraticCurveTo(c, y - 2.2, c + 3, y);
    }
    ctx.stroke();

    // Head with comb, eyes and a golden beak
    fill(ctx, mainColor);
    fillEllipse(ctx, c - 4.5, 18.5, 9, 8);
    stroke(ctx, darkColor, 0.7);
    strokeEllipse(ctx, c - 4.5, 18.5, 9, 8);
    fill(ctx, gold);
    fillPolygon(ctx, [
      [c - 2.2, 25.6],
      [c, 28],
      [c + 2.2, 25.6],
    ]);
    for (const side of [-1, 1]) {
      fill(ctx, whiteC);
      fillEllipse(ctx, c + side * 2.2 - 1.3, 22.2, 2.6, 2.6);
      fill(ctx, Colors.black);
      fillEllipse(ctx, c + side * 2.2 - 0.7, 22.8, 1.4, 1.4);
    }

    if (enemyType === EnemyType.Boss) {
      // The boss bird wears a golden crown and a skull on its back
      fill(ctx, gold);
      fillPolygon(ctx, [
        [c - 4, 18.5],
        [c - 4.5, 15.5],
        [c - 2, 17],
        [c, 14.8],
        [c + 2, 17],
        [c + 4.5, 15.5],
        [c + 4, 18.5],
      ]);
      fill(ctx, white(0.96));
      fillEllipse(ctx, c - 3, 9.5, 6, 5.5);
      ctx.fillRect(c - 1.8, 8.2, 3.6, 2);
      fill(ctx, Colors.black);
      fillEllipse(ctx, c - 2.3, 11.4, 1.8, 2);
      fillEllipse(ctx, c + 0.5, 11.4, 1.8, 2);
    } else {
      // Red comb on top of the head
      fill(ctx, rgb(0.9, 0.1, 0.1));
      for (let j = 0; j < 3; j++) fillEllipse(ctx, c - 2.6 + j * 1.8, 17.6, 1.8, 2.2);
    }
  });
}

/** Pre-rendered rainbow frames for POWER tanks (each frame has 2 track variants) */
function rainbowTextures(size: number): Texture[][] {
  const key = `${Math.trunc(size)}${GameState.isBirdStage ? "_bird" : ""}`;
  const cached = rainbowTextureCache.get(key);
  if (cached) return cached;
  const frames: Texture[][] = [];
  const scale = size / C.tankSize;
  for (let i = 0; i < RAINBOW_FRAME_COUNT; i++) {
    const hue = i / RAINBOW_FRAME_COUNT;
    const mainColor = hsb(hue, 1, 1);
    const darkColor = hsb(hue, 1, 0.6);
    frames.push([0, 1].map((t) => renderTankTexture(size, mainColor, darkColor, false, EnemyType.Power, t * 2.5 * scale)));
  }
  rainbowTextureCache.set(key, frames);
  return frames;
}

/** Tank entity - player or enemy */
export class Tank extends Node {
  isPlayer: boolean;
  playerNumber: number;
  enemyType: EnemyType;
  /** Type used for scoring: doesn't change when a damaged heavy/armored tank downgrades */
  scoreType: EnemyType;
  direction: Direction = Direction.Up;
  readonly size: Size;

  // Stats
  health = 1;
  maxHealth = 1;
  lives = 3;
  moveSpeed: number;

  // Combat
  bulletPower = 1;
  /** Shots still on the field. A machinegun burst counts as one shot. */
  activeBullets = 0;
  maxBullets = C.maxBulletsPerTank;
  /** Cheat screen multipliers (1 = normal): movement speed and shooting speed */
  cheatSpeed = 1;
  cheatFireRate = 1;
  shootCooldown = 0;

  // Power-ups
  hasShield = false;
  shieldTimer = 0;
  speedMultiplier = 1.0;
  /** Start speed from soccer balls: kept through deaths and levels until a new game */
  baseSpeedMultiplier = 1.0;
  starCount = 0;
  /** Bosses killed this game: each gives faster shooting, every 3rd also one more bullet per shot */
  bossFireBoost = 0;
  get bossExtraBullets(): number {
    return Math.floor(this.bossFireBoost / C.bossesPerExtraBullet);
  }
  /** MAGIC: safe from the enemies' bomb and freeze until the player dies or the round ends */
  hasMagic = false;
  /** Player deaths on this level that cost the soccer ball */
  deathsThisLevel = 0;
  canSwim = false; // SHIP power-up
  canDestroyTrees = false; // SAW power-up
  machinegunCount = 0; // Extra bullets (stackable)
  /** LASER: rounds it still lasts, counting the current one (0 = no laser) */
  laserRounds = 0;
  get hasLaser(): boolean {
    return this.laserRounds > 0;
  }

  /** Can drive on water: SHIP power-up, or innate for the alien and the boss */
  get canMoveOnWater(): boolean {
    return this.canSwim || (!this.isPlayer && (this.enemyType === EnemyType.Alien || this.enemyType === EnemyType.Boss));
  }

  /** Boss tank: a new random color every time one appears */
  private bossColor: Color | null = null;

  /** The alien always shoots laser light (through walls, but it can't hurt the base) */
  get firesAlienLaser(): boolean {
    return !this.isPlayer && this.enemyType === EnemyType.Alien;
  }

  /** The alien and the boss ignore FREEZE */
  get isFreezeImmune(): boolean {
    return !this.isPlayer && (this.enemyType === EnemyType.Alien || this.enemyType === EnemyType.Boss);
  }

  // Respawn
  respawnTimer = 0;
  pendingRespawnPosition: Point | null = null;

  // Track animation
  private trackFrame = 0;
  private cachedTextures: Texture[] = [];

  // Rainbow animation (POWER tanks)
  private rainbowFrameIndex = 0;
  private rainbow: Texture[][] | null = null;

  // Ice sliding
  private isOnIce = false;
  private slideDirection: Direction | null = null;
  private slideDistance = 0;
  private readonly iceSlideDistance = 32; // One tile
  private readonly iceSpeedBoost = 1.3; // 30% faster on ice

  ai: TankAI | null = null;

  constructor(position: Point, direction: Direction, isPlayer: boolean, playerNumber: number, enemyType: EnemyType = EnemyType.Regular) {
    super();
    this.isPlayer = isPlayer;
    this.playerNumber = playerNumber;
    this.enemyType = enemyType;
    this.scoreType = enemyType;

    if (isPlayer) {
      this.moveSpeed = C.tankSpeed;
    } else {
      switch (enemyType) {
        case EnemyType.Fast:
        case EnemyType.Boss:
          this.moveSpeed = C.enemyTankSpeed * 1.5;
          break;
        case EnemyType.Alien:
          this.moveSpeed = C.enemyTankSpeed * 1.2;
          break;
        case EnemyType.Gzhel:
          this.moveSpeed = C.enemyTankSpeed * 1.3;
          break;
        default:
          this.moveSpeed = C.enemyTankSpeed;
      }
    }

    switch (enemyType) {
      case EnemyType.Armored:
      case EnemyType.Power:
        this.health = 2;
        this.maxHealth = 2;
        break;
      case EnemyType.Heavy:
        this.health = 3;
        this.maxHealth = 3;
        this.bulletPower = 2;
        break;
      case EnemyType.Boss:
        this.health = C.bossBaseHealth;
        this.maxHealth = C.bossBaseHealth;
        this.bulletPower = 2; // Breaks steel
        break;
      case EnemyType.Gzhel:
        this.health = C.friendHits;
        this.maxHealth = C.friendHits;
        break;
      default:
        this.health = 1;
        this.maxHealth = 1;
    }

    const size = enemyType === EnemyType.Boss ? C.bossTankSize : enemyType === EnemyType.Alien && !isPlayer ? C.alienSize : C.tankSize;
    this.size = { width: size, height: size };

    this.position = { ...position };
    this.direction = direction;
    this.zRotation = rotation(direction);
    this.zPosition = 10;

    if (!isPlayer && enemyType === EnemyType.Boss) {
      this.bossColor = hsb(Math.random(), randomIn(0.75, 1), randomIn(0.75, 1));
    }
    if (!isPlayer) this.ai = new TankAI(this);

    this.drawTank();
  }

  // MARK: Drawing

  private get bodySprite(): SpriteNode | null {
    return this.childNode("tankBody") as SpriteNode | null;
  }

  drawTank(): void {
    this.removeAllChildren();
    this.cachedTextures = [];
    this.removeAction("rainbowAnimation");
    const tankSize = this.size.width;
    const [mainColor, darkColor] = this.getTankColors();

    // Alien: its own sprite (2 walking frames), no tank body
    if (!this.isPlayer && this.enemyType === EnemyType.Alien) {
      this.cachedTextures = alienTextures(tankSize);
      const alienSprite = new SpriteNode(this.cachedTextures[0], Colors.white, { width: tankSize, height: tankSize });
      alienSprite.name = "tankBody";
      this.addChild(alienSprite);
      if (this.canSwim) this.addShipIndicator(tankSize);
      return;
    }

    const scale = tankSize / C.tankSize;
    for (let i = 0; i < 2; i++) {
      this.cachedTextures.push(renderTankTexture(tankSize, mainColor, darkColor, this.isPlayer, this.enemyType, i * 2.5 * scale));
    }
    const tankSprite = new SpriteNode(this.cachedTextures[0], Colors.white, { width: tankSize, height: tankSize });
    tankSprite.name = "tankBody";
    this.addChild(tankSprite);

    if (this.hasShield) this.addShieldEffect(tankSize);
    if (this.hasMagic) this.addMagicEffect(tankSize);
    if (this.canSwim) this.addShipIndicator(tankSize);
    if (!this.isPlayer && this.enemyType === EnemyType.Power) this.startRainbowAnimation();
  }

  private getTankColors(): [Color, Color] {
    // Bonus stage birds wear Gorodets colors
    if (!this.isPlayer && GameState.isBirdStage) {
      switch (this.enemyType) {
        case EnemyType.Regular:
          return [rgb(0.88, 0.16, 0.1), rgb(0.5, 0.04, 0.04)];
        case EnemyType.Fast:
          return [rgb(1.0, 0.68, 0.1), rgb(0.72, 0.36, 0.0)];
        case EnemyType.Armored:
          return [rgb(0.16, 0.36, 0.82), rgb(0.05, 0.14, 0.45)];
        case EnemyType.Heavy:
          return [white(0.16), white(0.03)];
        default:
          break;
      }
    }
    if (this.isPlayer) {
      const main = this.playerColor;
      return [main, darker(main)];
    }
    switch (this.enemyType) {
      case EnemyType.Regular:
        return [Colors.red, rgb(0.55, 0, 0)];
      case EnemyType.Armored:
        return [rgb(0.55, 0, 0), rgb(0.31, 0, 0)];
      case EnemyType.Fast:
        return [rgb(1.0, 0.4, 0.4), rgb(0.78, 0.24, 0.24)];
      case EnemyType.Power:
        return [Colors.red, rgb(0.55, 0, 0)];
      case EnemyType.Boss: {
        const main = this.bossColor ?? hex("#FF4500");
        return [main, darker(main)];
      }
      case EnemyType.Heavy:
        return [Colors.darkGray, Colors.black];
      case EnemyType.Alien:
        return [rgb(0.4, 0.9, 0.4), rgb(0.2, 0.6, 0.2)];
      case EnemyType.Gzhel:
        return [rgb(0.97, 0.97, 1.0), rgb(0.0, 0.28, 0.67)];
    }
  }

  private startRainbowAnimation(): void {
    this.rainbow = rainbowTextures(this.size.width);
    const updateColor = Action.run(() => {
      const textures = this.rainbow;
      if (!textures || !textures.length) return;
      this.rainbowFrameIndex = (this.rainbowFrameIndex + 1) % textures.length;
      this.cachedTextures = textures[this.rainbowFrameIndex];
      const sprite = this.bodySprite;
      if (sprite) sprite.texture = this.cachedTextures[Math.floor(this.trackFrame / 4) % 2];
    });
    this.run(Action.repeatForever(Action.sequence([updateColor, Action.wait(4.0 / RAINBOW_FRAME_COUNT)])), "rainbowAnimation");
  }

  private addMagicEffect(tankSize: number): void {
    const ring = new Node();
    ring.name = "magic";
    ring.zPosition = 2;
    const radius = tankSize * 0.62;
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3;
      const sparkle = new LabelNode("✦");
      sparkle.fontSize = 9;
      sparkle.fontColor = rgb(0.8, 0.55, 1.0);
      sparkle.verticalAlignmentMode = "center";
      sparkle.position = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      ring.addChild(sparkle);
    }
    ring.run(Action.repeatForever(Action.rotateBy(Math.PI * 2, 2.5)));
    this.addChild(ring);
  }

  private addShieldEffect(tankSize: number): void {
    const container = new Node();
    container.name = "shield";
    const radius = tankSize * 0.65;
    const ring = (color: Color, width: number) => {
      const s = ShapeNode.circle(radius);
      s.strokeColor = color;
      s.lineWidth = width;
      s.fillColor = Colors.clear;
      container.addChild(s);
      return s;
    };
    const shield1 = ring(Colors.cyan, 2);
    const shield2 = ring(withAlpha(Colors.cyan, 0.6), 2);
    const shield3 = ring(withAlpha(Colors.white, 0.4), 1);
    shield1.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.1, 0.15), Action.scaleTo(0.95, 0.15)])));
    shield2.run(Action.repeatForever(Action.sequence([Action.scaleTo(0.95, 0.15), Action.scaleTo(1.1, 0.15)])));
    shield3.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.05, 0.1), Action.scaleTo(1.0, 0.1)])));
    container.run(Action.repeatForever(Action.rotateBy(Math.PI * 2, 1.0)));
    this.addChild(container);
  }

  private addShipIndicator(tankSize: number): void {
    const container = new Node();
    container.name = "shipIndicator";
    const t = tankSize * 0.8;
    const triangle = new ShapeNode(
      new Path()
        .moveTo(0, t)
        .lineTo(-t * 0.7, -t * 0.5)
        .lineTo(t * 0.7, -t * 0.5)
        .close(),
    );
    triangle.fillColor = withAlpha(Colors.blue, 0.2);
    triangle.strokeColor = Colors.cyan;
    triangle.lineWidth = 2;
    container.addChild(triangle);
    container.run(Action.repeatForever(Action.sequence([Action.moveBy(0, 2, 0.3), Action.moveBy(0, -2, 0.3)])));
    this.addChild(container);
  }

  /** Tank color of a human player (1 or 2), as chosen in Options */
  static colorForPlayer(n: number): Color {
    return n === 2 ? tankColorOf(GameSettings.player2TankColor) : tankColorOf(GameSettings.playerTankColor);
  }

  private get playerColor(): Color {
    switch (this.playerNumber) {
      case 1:
        return tankColorOf(GameSettings.playerTankColor);
      case 2:
        return tankColorOf(GameSettings.player2TankColor);
      case 3:
        return hex("#FF6600");
      case 4:
        return hex("#FF00FF");
      default:
        return Colors.yellow;
    }
  }

  /** Short tint of the tank body (hit / ship lost) */
  private flash(color: Color): void {
    const body = this.bodySprite;
    if (!body) return;
    body.run(Action.sequence([Action.colorize(color, 1, 0.1), Action.colorize(null, 0, 0.1)]), "flash");
  }

  // MARK: Movement

  /** Turn to face a direction without moving */
  turn(direction: Direction): void {
    this.direction = direction;
    this.zRotation = rotation(direction);
  }

  move(direction: Direction, map: GameMap, allTanks: Tank[]): void {
    const wasOnIce = this.isOnIce;
    this.isOnIce = map.isIceTile(this.position);

    // Changing direction while sliding: start a new slide
    if (this.isOnIce && this.slideDirection !== null && this.slideDirection !== direction) {
      this.slideDirection = direction;
      this.slideDistance = 0;
    }

    this.direction = direction;
    this.zRotation = rotation(direction);

    const v = velocity(direction);
    const iceMultiplier = this.isOnIce ? this.iceSpeedBoost : 1.0;
    const speed = this.moveSpeed * this.speedMultiplier * this.cheatSpeed * iceMultiplier;
    const newPosition = { x: this.position.x + v.dx * speed, y: this.position.y + v.dy * speed };

    let didMove = false;
    let finalPosition = newPosition;

    if (!map.checkTankCollision(newPosition, this.size.width, this.canMoveOnWater) && !this.collidesWithTanks(newPosition, allTanks)) {
      didMove = true;
    }

    // Blocked: slide to line up with the tile grid (like the original Battle City)
    if (!didMove) {
      const slide = this.trySlideMove(direction, map, allTanks);
      if (slide) {
        finalPosition = slide;
        didMove = true;
      }
    }

    if (didMove) {
      this.position = finalPosition;
      this.animateTracks();
      if (this.isOnIce) {
        this.slideDirection = direction;
        this.slideDistance = 0;
      }
    }

    if (this.isOnIce && !wasOnIce) {
      this.slideDirection = direction;
      this.slideDistance = 0;
    }
  }

  /** Keep sliding on ice after input stops (one extra tile) */
  continueIceSlide(map: GameMap, allTanks: Tank[]): boolean {
    const dir = this.slideDirection;
    if (dir === null || this.slideDistance >= this.iceSlideDistance) {
      this.slideDirection = null;
      this.slideDistance = 0;
      this.isOnIce = false;
      return false;
    }
    const v = velocity(dir);
    const slideSpeed = this.moveSpeed * this.speedMultiplier * this.cheatSpeed * this.iceSpeedBoost;
    const newPosition = { x: this.position.x + v.dx * slideSpeed, y: this.position.y + v.dy * slideSpeed };

    if (!map.checkTankCollision(newPosition, this.size.width, this.canMoveOnWater) && !this.collidesWithTanks(newPosition, allTanks)) {
      this.position = newPosition;
      this.slideDistance += slideSpeed;
      this.animateTracks();
      this.isOnIce = map.isIceTile(this.position);
      if (this.slideDistance >= this.iceSlideDistance) {
        this.slideDirection = null;
        this.slideDistance = 0;
        return false;
      }
      return true;
    }

    this.slideDirection = null;
    this.slideDistance = 0;
    return false;
  }

  get isSliding(): boolean {
    return this.slideDirection !== null && this.slideDistance < this.iceSlideDistance;
  }

  private animateTracks(): void {
    if (this.cachedTextures.length < 2) return;
    this.trackFrame = (this.trackFrame + 1) % 8;
    const sprite = this.bodySprite;
    if (sprite) sprite.texture = this.cachedTextures[Math.floor(this.trackFrame / 4) % 2];
  }

  /** Slide sideways toward the tile center to line up with a gap (max 0.5 px per frame) */
  private trySlideMove(direction: Direction, map: GameMap, allTanks: Tank[]): Point | null {
    const tileSize = C.tileSize;
    const slideAmount = Math.min(this.moveSpeed * this.speedMultiplier * this.cheatSpeed, 0.5);
    const tileCenterX = (Math.floor(this.position.x / tileSize) + 0.5) * tileSize;
    const tileCenterY = (Math.floor(this.position.y / tileSize) + 0.5) * tileSize;
    const offsetX = this.position.x - tileCenterX;
    const offsetY = this.position.y - tileCenterY;

    let test: Point | null = null;
    if (direction === Direction.Left || direction === Direction.Right) {
      if (Math.abs(offsetY) > 1) {
        const dir = offsetY > 0 ? -1 : 1;
        test = { x: this.position.x, y: this.position.y + dir * Math.min(slideAmount, Math.abs(offsetY)) };
      }
    } else if (Math.abs(offsetX) > 1) {
      const dir = offsetX > 0 ? -1 : 1;
      test = { x: this.position.x + dir * Math.min(slideAmount, Math.abs(offsetX)), y: this.position.y };
    }
    if (test && !map.checkTankCollision(test, this.size.width, this.canMoveOnWater) && !this.collidesWithTanks(test, allTanks)) {
      return test;
    }
    return null;
  }

  private collidesWithTanks(at: Point, allTanks: Tank[]): boolean {
    for (const tank of allTanks) {
      if (tank !== this && tank.isAlive && this.checkCollision(tank, at)) return true;
    }
    return false;
  }

  private checkCollision(other: Tank, at: Point): boolean {
    const minDist = this.size.width / 2 + other.size.width / 2;
    return Math.abs(at.x - other.position.x) < minDist && Math.abs(at.y - other.position.y) < minDist;
  }

  // MARK: Combat

  get canShoot(): boolean {
    return this.activeBullets < this.maxBullets && this.shootCooldown <= 0 && this.isAlive;
  }

  shoot(): Bullet[] {
    if (!this.canShoot) return [];
    const bullets: Bullet[] = [];
    // 1 + machinegun power-ups + every 3rd defeated boss (max 4)
    const bulletCount = Math.min(1 + this.machinegunCount + this.bossExtraBullets, 4);
    // Cooldown reduced by stars and defeated bosses (min 5 frames)
    const baseCooldown = Math.max(5, 30 - (this.starCount + this.bossFireBoost) * C.fireBoostStep);
    this.shootCooldown = this.cheatFireRate === 1 ? baseCooldown : Math.max(2, Math.round(baseCooldown / this.cheatFireRate));

    const bulletOffset = this.size.width / 2 + C.bulletSize / 2;
    const bulletSpacing = C.bulletSize * 2;
    const burst = new Burst(bulletCount);
    this.activeBullets += 1; // The whole burst is one shot

    const v = velocity(this.direction);
    for (let i = 0; i < bulletCount; i++) {
      const d = bulletOffset + i * bulletSpacing;
      bullets.push(
        new Bullet(this.position.x + v.dx * d, this.position.y + v.dy * d, this.direction, this, {
          power: this.bulletPower,
          isLaser: this.hasLaser || this.firesAlienLaser,
          burst,
        }),
      );
    }
    return bullets;
  }

  bulletDestroyed(bullet: Bullet, hitObstacle = false): void {
    // A burst's shot is over once its last bullet is gone
    if (bullet.burst) {
      bullet.burst.remaining -= 1;
      if (bullet.burst.remaining > 0) return;
    }
    this.activeBullets = Math.max(0, this.activeBullets - 1);
    // Can shoot again right away (original Battle City behavior);
    // in easy mode enemies whose bullet hit a wall wait for the cooldown
    if (this.activeBullets === 0) {
      if (this.isPlayer || !hitObstacle || !GameState.isEasyMode) this.shootCooldown = 0;
    }
  }

  damage(bypassShip = false, bypassShield = false): void {
    if (!this.isAlive) return;
    if (this.hasShield && !bypassShield) return;

    // Ship: the first hit only takes the ship (unless bypassed by a bomb)
    if (this.canSwim && !bypassShip) {
      this.canSwim = false;
      // Losing the ship out on the water: the tank sinks (alien/boss swim on their own)
      if (this.isOnWater && !this.canMoveOnWater) {
        this.health = 0;
        this.die();
        return;
      }
      this.drawTank();
      this.flash(Colors.cyan);
      return;
    }

    this.health -= 1;
    if (this.health <= 0) {
      this.die();
    } else {
      if (!this.isPlayer) {
        if (this.enemyType === EnemyType.Heavy) {
          this.enemyType = EnemyType.Armored; // HEAVY → ARMORED
          this.bulletPower = 1;
          this.drawTank();
        } else if (this.enemyType === EnemyType.Armored) {
          this.enemyType = EnemyType.Regular; // ARMORED → REGULAR
          this.drawTank();
        }
      }
      this.flash(Colors.red);
    }
  }

  /** Instant kill ignoring ship, shield and armor (LASER hits) */
  destroyInstantly(): void {
    if (!this.isAlive) return;
    this.health = 1;
    this.damage(true, true);
  }

  /** Tank's center is on a water tile */
  private get isOnWater(): boolean {
    return GameState.currentMap?.getTile(this.position) === Tile.Water;
  }

  private die(): void {
    // The friend leaves with its own animation (played by the scene)
    if (this.isOnWater) {
      this.createWhirlpool();
    } else if (this.isPlayer || this.enemyType !== EnemyType.Gzhel) {
      this.createExplosion();
    }
    if (this.isPlayer) {
      this.lives -= 1;
      this.deathsThisLevel += 1;
      // Power-ups are lost right away, so the sidebar shows it
      this.resetPowerUps();
      this.isHidden = true;
    }
    this.health = 0;
  }

  /** Drowning: the tank spins down into a whirlpool and disappears */
  private createWhirlpool(): void {
    const parent = this.parent;
    if (!parent) return;
    const duration = 1.2;
    const radius = this.tankSize * 0.9;

    const pool = new Node();
    pool.position = { ...this.position };
    pool.zPosition = this.zPosition;

    const eye = ShapeNode.circle(radius * 0.45);
    eye.fillColor = rgb(0.0, 0.12, 0.35, 0.85);
    eye.strokeColor = Colors.clear;
    eye.setScale(0.2);
    pool.addChild(eye);
    eye.run(
      Action.sequence([
        Action.scaleTo(1.0, duration * 0.4),
        Action.wait(duration * 0.3),
        Action.group([Action.scaleTo(0.1, duration * 0.3), Action.fadeOut(duration * 0.3)]),
      ]),
    );

    // Spiral arms of foam
    const spiral = new Path();
    const arms = 3;
    for (let arm = 0; arm < arms; arm++) {
      const start = (arm * 2 * Math.PI) / arms;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + t * 2.4 * Math.PI;
        const r = radius * (0.12 + 0.88 * t);
        if (i === 0) spiral.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else spiral.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
    }
    const swirl = new ShapeNode(spiral);
    swirl.strokeColor = rgb(0.75, 0.92, 1.0, 0.9);
    swirl.lineWidth = Math.max(1.5, this.tankSize * 0.07);
    swirl.lineCap = "round";
    swirl.alpha = 0;
    swirl.setScale(0.5);
    pool.addChild(swirl);
    swirl.run(
      Action.group([
        Action.rotateBy(-5 * Math.PI, duration),
        Action.sequence([
          Action.group([Action.fadeIn(duration * 0.2), Action.scaleTo(1.0, duration * 0.4)]),
          Action.wait(duration * 0.3),
          Action.group([Action.scaleTo(0.2, duration * 0.3), Action.fadeOut(duration * 0.3)]),
        ]),
      ]),
    );

    // The tank itself spins and shrinks as it goes under
    const texture = this.cachedTextures[0];
    if (texture) {
      const hull = new SpriteNode(texture, Colors.white, { width: this.tankSize, height: this.tankSize });
      hull.zRotation = this.zRotation;
      pool.addChild(hull);
      hull.run(
        Action.group([
          Action.rotateBy(-3 * Math.PI, duration * 0.85),
          Action.scaleTo(0.05, duration * 0.85),
          Action.sequence([Action.wait(duration * 0.35), Action.fadeOut(duration * 0.5)]),
        ]),
      );
    }

    // Bubbles rising from the spot
    for (let i = 0; i < 6; i++) {
      const bubble = ShapeNode.circle(randomIn(1.5, 3));
      bubble.strokeColor = white(1, 0.85);
      bubble.fillColor = white(1, 0.25);
      bubble.lineWidth = 1;
      bubble.position = { x: randomIn(-radius * 0.4, radius * 0.4), y: randomIn(-radius * 0.4, radius * 0.4) };
      bubble.alpha = 0;
      pool.addChild(bubble);
      bubble.run(
        Action.sequence([
          Action.wait(duration * 0.5 + i * 0.08),
          Action.fadeIn(0.05),
          Action.group([Action.moveBy(0, randomIn(8, 16), 0.4), Action.fadeOut(0.4)]),
        ]),
      );
    }

    parent.addChild(pool);
    pool.run(Action.sequence([Action.wait(duration + 0.5), Action.removeFromParent()]));
  }

  private createExplosion(): void {
    const parent = this.parent;
    if (!parent) return;
    const explosion = new Node();
    explosion.position = { ...this.position };
    explosion.zPosition = 100;
    const colors = [Colors.red, Colors.orange, Colors.yellow];

    // Expanding circles
    const circleKeys = ["explosion_red", "explosion_orange", "explosion_yellow"];
    for (let i = 0; i < 3; i++) {
      const circle = new SpriteNode(explosionTexture(colors[i], 5, circleKeys[i]), Colors.white, { width: 10, height: 10 });
      explosion.addChild(circle);
      circle.run(Action.sequence([Action.wait(i * 0.05), Action.group([Action.scaleTo(3.0 - i * 0.5, 0.3), Action.fadeOut(0.3)])]));
    }

    // Particles
    const particleKeys = ["particle_red", "particle_orange", "particle_yellow"];
    for (let i = 0; i < 8; i++) {
      const ci = Math.floor(Math.random() * 3);
      const particle = new SpriteNode(explosionTexture(colors[ci], 3, particleKeys[ci]), Colors.white, { width: 6, height: 6 });
      explosion.addChild(particle);
      const angle = randomIn(0, Math.PI * 2);
      const distance = randomIn(20, 40);
      particle.run(Action.group([Action.moveBy(Math.cos(angle) * distance, Math.sin(angle) * distance, 0.4), Action.fadeOut(0.4)]));
    }

    parent.addChild(explosion);
    explosion.run(Action.sequence([Action.wait(0.5), Action.removeFromParent()]));
  }

  get isAlive(): boolean {
    return this.health > 0;
  }

  get tankSize(): number {
    return this.size.width;
  }

  get isWaitingToRespawn(): boolean {
    return this.respawnTimer > 0;
  }

  respawn(at: Point): void {
    this.pendingRespawnPosition = { ...at };
    this.respawnTimer = C.respawnDelay;
  }

  updateRespawnTimer(): void {
    if (this.respawnTimer <= 0) return;
    this.respawnTimer -= 1;
    if (this.respawnTimer === 0) this.completeRespawn();
  }

  private completeRespawn(): void {
    this.position = { ...(this.pendingRespawnPosition ?? spawnPosition(1)) };
    this.health = this.maxHealth;
    this.isHidden = false;
    this.alpha = 1.0;
    this.resetPowerUps();
    // Temporary shield after respawn
    this.hasShield = true;
    this.shieldTimer = C.temporaryShieldDuration;
    this.drawTank();
    this.pendingRespawnPosition = null;
  }

  /** Reset all power-ups (player died) */
  resetPowerUps(): void {
    this.starCount = 0;
    this.bulletPower = 1;
    this.speedMultiplier = this.baseSpeedMultiplier;
    this.canSwim = false;
    this.canDestroyTrees = false;
    this.machinegunCount = 0;
    this.laserRounds = 0;
    this.hasMagic = false;
    this.moveSpeed = this.isPlayer ? C.tankSpeed : C.enemyTankSpeed;
  }

  /** Soccer ball: raises the start speed (and the current speed) by one step */
  addBallSpeedBoost(): void {
    const newBase = Math.min(this.baseSpeedMultiplier + C.ballSpeedBoost, C.ballMaxBaseSpeed);
    const gained = newBase - this.baseSpeedMultiplier;
    this.baseSpeedMultiplier = newBase;
    this.speedMultiplier = Math.min(this.speedMultiplier + gained, 2.5);
  }

  addLives(count: number): void {
    this.lives += count;
  }

  activateShield(duration: number): void {
    this.hasShield = true;
    this.shieldTimer = duration;
    this.drawTank();
  }

  activateShip(): void {
    this.canSwim = true;
    this.drawTank();
  }

  convertToType(newType: EnemyType): void {
    // Special tanks keep their type
    if (this.isPlayer || this.enemyType === EnemyType.Alien || this.enemyType === EnemyType.Gzhel || this.enemyType === EnemyType.Boss) return;
    this.removeAction("rainbowAnimation");
    this.enemyType = newType;
    this.scoreType = newType;
    switch (newType) {
      case EnemyType.Fast:
        this.moveSpeed = C.enemyTankSpeed * 1.5;
        this.health = 1;
        this.maxHealth = 1;
        this.bulletPower = 1;
        break;
      case EnemyType.Armored:
      case EnemyType.Power:
        this.moveSpeed = C.enemyTankSpeed;
        this.health = 2;
        this.maxHealth = 2;
        this.bulletPower = 1;
        break;
      case EnemyType.Heavy:
        this.moveSpeed = C.enemyTankSpeed * 0.8;
        this.health = 3;
        this.maxHealth = 3;
        this.bulletPower = 2;
        break;
      default:
        this.moveSpeed = C.enemyTankSpeed;
        this.health = 1;
        this.maxHealth = 1;
        this.bulletPower = 1;
    }
    this.drawTank();
  }

  // MARK: Update

  update(): void {
    if (this.shootCooldown > 0) this.shootCooldown -= 1;
    if (this.hasShield) {
      this.shieldTimer -= 1;
      if (this.shieldTimer <= 0) {
        this.hasShield = false;
        this.childNode("shield")?.removeFromParent();
      } else if (this.shieldTimer <= SHIELD_WARNING_FRAMES) {
        // About to run out: the shield flashes 3 times
        const shield = this.childNode("shield");
        if (shield) shield.isHidden = this.shieldTimer % 30 >= 15;
      }
    }
    this.updateRespawnTimer();
  }
}
