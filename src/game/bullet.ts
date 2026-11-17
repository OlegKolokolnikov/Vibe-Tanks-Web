import { Colors, css, rgb, withAlpha, type Color } from "../engine/color";
import type { Size } from "../engine/geometry";
import { SpriteNode, makeTexture, type Texture } from "../engine/node";
import { C, EnemyType } from "./constants";
import { Direction, rotation, velocity } from "./direction";
import type { Tank } from "./tank";

/** Bullets fired together in one shot (machinegun): the shot ends when all are gone */
export class Burst {
  constructor(public remaining: number) {}
}

const LASER_SIZE: Size = { width: 6, height: 20 };
const textureCache = new Map<string, Texture>();

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Glow with a white-hot core (vertical): cyan for players, green for the alien */
function laserTexture(alien: boolean): Texture {
  const key = alien ? "laser-alien" : "laser";
  let texture = textureCache.get(key);
  if (!texture) {
    const glow: Color = alien ? rgb(0.3, 1, 0.3) : Colors.cyan;
    const { width, height } = LASER_SIZE;
    texture = makeTexture(width, height, (ctx) => {
      ctx.fillStyle = css(withAlpha(glow, 0.45));
      roundRectPath(ctx, 0, 0, width, height, 3);
      ctx.fill();
      ctx.fillStyle = css(glow);
      roundRectPath(ctx, 1, 1, width - 2, height - 2, 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      roundRectPath(ctx, 2, 2, width - 4, height - 4, 1);
      ctx.fill();
    });
    textureCache.set(key, texture);
  }
  return texture;
}

/** Simple circular texture for the bullet */
function bulletTexture(key: string, color: Color): Texture {
  let texture = textureCache.get(key);
  if (!texture) {
    const size = C.bulletSize;
    texture = makeTexture(size, size, (ctx) => {
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.ellipse(size / 2, size / 2, size / 2, size / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css(Colors.orange);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(size / 2, size / 2, (size - 1) / 2, (size - 1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    textureCache.set(key, texture);
  }
  return texture;
}

/** Bullet projectile */
export class Bullet extends SpriteNode {
  readonly direction: Direction;
  owner: Tank | null;
  readonly burst: Burst | null;
  readonly power: number;
  readonly moveSpeed: number;
  /** LASER shot: a bolt of light that passes through walls */
  readonly isLaser: boolean;
  /** Side is fixed when fired, so an enemy's bullets stay enemy bullets after it dies */
  readonly isFromEnemy: boolean;
  /** Fired by the Gzhel tank: hurts enemies and the base, harmless to the player */
  readonly isFromGzhel: boolean;

  get isEnemy(): boolean {
    return this.isFromEnemy;
  }

  constructor(x: number, y: number, direction: Direction, owner: Tank | null, options: { power?: number; isLaser?: boolean; burst?: Burst | null; isEnemy?: boolean } = {}) {
    const isLaser = options.isLaser ?? false;
    const isPlayer = owner?.isPlayer ?? false;
    const isFromGzhel = owner ? !owner.isPlayer && owner.enemyType === EnemyType.Gzhel : false;
    let texture: Texture;
    let size: Size;
    if (!owner) {
      // UFO bullet (no tank owner)
      texture = bulletTexture("green", Colors.green);
      size = { width: C.bulletSize, height: C.bulletSize };
    } else if (isLaser) {
      texture = laserTexture(!isPlayer);
      size = LASER_SIZE;
    } else {
      const key = isPlayer ? "yellow" : isFromGzhel ? "blue" : "white";
      const color = isPlayer ? Colors.yellow : isFromGzhel ? rgb(0.2, 0.45, 1) : Colors.white;
      texture = bulletTexture(key, color);
      size = { width: C.bulletSize, height: C.bulletSize };
    }
    super(texture, Colors.white, size);

    this.direction = direction;
    this.owner = owner;
    this.burst = options.burst ?? null;
    this.power = options.power ?? 1;
    this.isLaser = isLaser && owner !== null;
    this.moveSpeed = this.isLaser ? C.laserSpeed : C.bulletSpeed;
    this.isFromGzhel = isFromGzhel;
    this.isFromEnemy = owner ? !owner.isPlayer && owner.enemyType !== EnemyType.Gzhel : (options.isEnemy ?? true);

    if (this.isLaser) {
      this.zRotation = rotation(direction);
      this.blendMode = "lighter";
    }
    this.position = { x, y };
    this.zPosition = this.isLaser ? 16 : 5; // Light shines above forest
  }

  update(): void {
    const v = velocity(this.direction);
    this.position.x += v.dx * this.moveSpeed;
    this.position.y += v.dy * this.moveSpeed;
  }

  isOutOfBounds(mapSize: Size): boolean {
    const p = this.position;
    return p.x < 0 || p.x > mapSize.width || p.y < 0 || p.y > mapSize.height;
  }

  collidesWithBullet(other: Bullet): boolean {
    if (this.isLaser !== other.isLaser) {
      // The fast laser covers more than a bullet's width per frame:
      // check the whole stretch it (and the other shot) moved through this frame
      const laser = this.isLaser ? this : other;
      const shot = this.isLaser ? other : this;
      return laser.sweptHit(shot);
    }
    const dx = this.position.x - other.position.x;
    const dy = this.position.y - other.position.y;
    return Math.sqrt(dx * dx + dy * dy) < C.bulletSize;
  }

  /** Did `other` cross the path this shot travelled during the last frame? */
  private sweptHit(other: Bullet): boolean {
    const v = velocity(this.direction);
    const rx = other.position.x - this.position.x;
    const ry = other.position.y - this.position.y;
    const along = rx * v.dx + ry * v.dy; // Ahead (+) or behind (-) along the flight line
    const aside = Math.abs(rx * v.dy - ry * v.dx); // Distance off the flight line
    const reach = C.bulletSize;
    const back = this.moveSpeed + other.moveSpeed + reach;
    return aside < reach && along > -back && along < reach;
  }

  collidesWithTank(tank: Tank): boolean {
    const tankHalfSize = tank.size.width / 2;
    const bulletRadius = C.bulletSize / 2;
    const dx = Math.abs(this.position.x - tank.position.x);
    const dy = Math.abs(this.position.y - tank.position.y);
    return dx < tankHalfSize + bulletRadius && dy < tankHalfSize + bulletRadius;
  }
}
