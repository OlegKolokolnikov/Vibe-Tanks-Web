import { distance, randomElement, shuffled, type Point } from "../engine/geometry";
import type { Bullet } from "./bullet";
import { C, EnemyType } from "./constants";
import { ALL_DIRECTIONS, Direction, opposite, randomDirection, turnedLeft, turnedRight, velocity } from "./direction";
import { Tile, type GameMap } from "./map";
import type { Tank } from "./tank";

export interface AIDecision {
  direction: Direction | null;
  shouldShoot: boolean;
}

const UNREACHABLE = Number.MAX_SAFE_INTEGER;

const NONE: AIDecision = { direction: null, shouldShoot: false };

function decision(direction: Direction | null, shouldShoot: boolean): AIDecision {
  return { direction, shouldShoot };
}

function tileOf(point: Point): [number, number] {
  const col = Math.trunc(point.x / C.tileSize);
  const row = C.mapHeight - 1 - Math.trunc(point.y / C.tileSize);
  return [row, col];
}

function tileCenter(row: number, col: number): Point {
  return { x: (col + 0.5) * C.tileSize, y: (C.mapHeight - 1 - row + 0.5) * C.tileSize };
}

/** Row/column change for one tile in a direction (rows grow downward) */
function tileStep(direction: Direction): [number, number] {
  switch (direction) {
    case Direction.Up:
      return [-1, 0];
    case Direction.Down:
      return [1, 0];
    case Direction.Left:
      return [0, -1];
    case Direction.Right:
      return [0, 1];
  }
}

function routeDistance(route: number[][], row: number, col: number): number {
  if (row < 0 || row >= route.length || col < 0 || col >= route[row].length) return UNREACHABLE;
  return route[row][col];
}

/** Base walls (bricks around the cat): the friend never shoots or drives through them */
function isBaseWall(row: number, col: number): boolean {
  return row >= C.mapHeight - 3 && row <= C.mapHeight - 2 && col >= 12 && col <= 14;
}

const BASE_POSITION: Point = { x: 13 * C.tileSize + C.tileSize / 2, y: C.tileSize * 1.5 };
/** Where the friend parks when the level is cleared: right in front of the base */
const HOME_SPOT = tileCenter(C.mapHeight - 4, Math.floor(C.mapWidth / 2));

/** AI controller for enemy tanks (and the Gzhel friend) */
export class TankAI {
  private targetDirection: Direction = randomDirection();
  private directionChangeTimer = 0;
  private stuckTimer = 0;
  private lastPosition: Point = { x: 0, y: 0 };
  private moveTimer = 0;
  /** Recently shot at a wall (avoid repeated wall shooting) */
  private shotAtWallTimer = 0;

  // Gzhel friend: route to its target (distance field over tiles, rebuilt every few frames)
  private friendRoute: number[][] = [];
  private friendRouteTimer = 0;
  private friendWanderTimer = 0;
  private friendWanderDirection: Direction = Direction.Up;
  /** Level cleared: the friend heads for the base once no power-ups are left */
  private friendGoingHome = false;

  private readonly directionChangeInterval: number;
  private readonly shootChance: number;
  private readonly aggressiveness: number;

  constructor(private readonly tank: Tank) {
    const settings: Record<EnemyType, [number, number, number]> = {
      [EnemyType.Regular]: [0.3, 60, 0.02],
      [EnemyType.Fast]: [0.4, 40, 0.025],
      [EnemyType.Armored]: [0.35, 70, 0.02],
      [EnemyType.Power]: [0.5, 50, 0.03],
      [EnemyType.Heavy]: [0.6, 60, 0.035],
      [EnemyType.Boss]: [0.7, 45, 0.04],
      [EnemyType.Alien]: [0.5, 45, 0.03],
      [EnemyType.Gzhel]: [0.8, 45, 0.03],
    };
    [this.aggressiveness, this.directionChangeInterval, this.shootChance] = settings[tank.enemyType];
  }

  update(map: GameMap, playerTanks: Tank[], allTanks: Tank[]): AIDecision {
    const tank = this.tank;
    if (!tank.isAlive) return NONE;
    if (this.shotAtWallTimer > 0) this.shotAtWallTimer -= 1;

    // Stuck?
    if (distance(tank.position, this.lastPosition) < 0.5) {
      this.stuckTimer += 1;
      if (this.stuckTimer > 20) {
        this.targetDirection = this.findOpenDirection(map, allTanks, this.targetDirection);
        this.stuckTimer = 0;
        this.moveTimer = 0;
        this.directionChangeTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
      this.moveTimer += 1;
    }
    this.lastPosition = { ...tank.position };

    this.directionChangeTimer += 1;
    if (this.directionChangeTimer >= this.directionChangeInterval) {
      this.directionChangeTimer = 0;
      if (Math.random() < 0.7) {
        this.targetDirection = this.chooseNewDirection(map, playerTanks, allTanks);
        this.moveTimer = 0;
      }
    }

    // Change direction randomly sometimes for variety
    if (this.moveTimer > 30 && Math.random() < 0.02) {
      this.targetDirection = this.chooseNewDirection(map, playerTanks, allTanks);
      this.moveTimer = 0;
      this.directionChangeTimer = 0;
    }

    return decision(this.targetDirection, this.decideToShoot(map, playerTanks));
  }

  /** Mix of random exploration and targeting */
  private chooseNewDirection(map: GameMap, playerTanks: Tank[], allTanks: Tank[]): Direction {
    if (Math.random() < this.aggressiveness) {
      const playerDir = this.directionTowardsPlayer(playerTanks);
      if (playerDir && !this.isDirectionBlocked(playerDir, map, allTanks)) return playerDir;
    }
    // Head toward the base (not the Gzhel ally)
    if (this.tank.enemyType !== EnemyType.Gzhel && Math.random() < 0.3) {
      if (!this.isDirectionBlocked(Direction.Down, map, allTanks)) return Direction.Down;
    }
    return this.findOpenDirection(map, allTanks, null);
  }

  private findOpenDirection(map: GameMap, allTanks: Tank[], exclude: Direction | null): Direction {
    const open = ALL_DIRECTIONS.filter((dir) => dir !== exclude && !this.isDirectionBlocked(dir, map, allTanks));
    if (this.tank.enemyType !== EnemyType.Gzhel && open.includes(Direction.Down) && Math.random() < 0.35) return Direction.Down;
    return randomElement(open) ?? randomDirection();
  }

  private isDirectionBlocked(dir: Direction, map: GameMap, allTanks: Tank[]): boolean {
    const tank = this.tank;
    const v = velocity(dir);
    const test = { x: tank.position.x + v.dx * 32, y: tank.position.y + v.dy * 32 };
    if (map.checkTankCollision(test, tank.size.width, tank.canMoveOnWater)) return true;
    for (const other of allTanks) {
      if (other !== tank && other.isAlive && distance(test, other.position) < tank.size.width) return true;
    }
    return false;
  }

  private decideToShoot(map: GameMap, playerTanks: Tank[]): boolean {
    const tank = this.tank;
    // The alien always keeps shooting
    if (tank.enemyType === EnemyType.Alien) {
      if (this.playerInLineOfFire(playerTanks, map) || this.isBaseInLineOfFire()) return Math.random() < 0.5;
      return Math.random() < this.shootChance;
    }
    if (this.shotAtWallTimer > 0) return false;
    if (this.playerInLineOfFire(playerTanks, map)) return Math.random() < 0.35;
    if (tank.enemyType !== EnemyType.Gzhel && this.isBaseInLineOfFire()) return Math.random() < 0.4;

    const [obstacle, dist] = this.checkObstacleInFront(map);
    switch (obstacle) {
      case Tile.Brick:
        if (dist < 80 && Math.random() < 0.03) {
          this.shotAtWallTimer = 45;
          return true;
        }
        return false;
      case Tile.Steel:
      case Tile.Water:
        return false; // Don't waste bullets
      default:
        return Math.random() < this.shootChance;
    }
  }

  private checkObstacleInFront(map: GameMap): [Tile, number] {
    const tank = this.tank;
    const v = velocity(tank.direction);
    for (let dist = 24; dist <= 120; dist += 16) {
      const tile = map.getTile({ x: tank.position.x + v.dx * dist, y: tank.position.y + v.dy * dist });
      if (tile !== Tile.Empty && tile !== Tile.Forest && tile !== Tile.Ice) return [tile, dist];
    }
    return [Tile.Empty, 1000];
  }

  private isBaseInLineOfFire(): boolean {
    const tank = this.tank;
    const dx = BASE_POSITION.x - tank.position.x;
    const dy = BASE_POSITION.y - tank.position.y;
    switch (tank.direction) {
      case Direction.Down:
        return dy < 0 && Math.abs(dy) < 250 && Math.abs(dx) < 48;
      case Direction.Left:
        return dx < 0 && Math.abs(dx) < 250 && Math.abs(dy) < 48;
      case Direction.Right:
        return dx > 0 && dx < 250 && Math.abs(dy) < 48;
      default:
        return false;
    }
  }

  private playerInLineOfFire(playerTanks: Tank[], map: GameMap): boolean {
    const tank = this.tank;
    for (const player of playerTanks) {
      if (!player.isAlive) continue;
      const dx = player.position.x - tank.position.x;
      const dy = player.position.y - tank.position.y;
      let inLine: boolean;
      switch (tank.direction) {
        case Direction.Up:
          inLine = dy > 0 && dy < 200 && Math.abs(dx) < 36;
          break;
        case Direction.Down:
          inLine = dy < 0 && Math.abs(dy) < 200 && Math.abs(dx) < 36;
          break;
        case Direction.Left:
          inLine = dx < 0 && Math.abs(dx) < 200 && Math.abs(dy) < 36;
          break;
        case Direction.Right:
          inLine = dx > 0 && dx < 200 && Math.abs(dy) < 36;
          break;
      }
      if (inLine && !this.hasSteelWallBlocking(player.position, map)) return true;
    }
    return false;
  }

  private hasSteelWallBlocking(target: Point, map: GameMap): boolean {
    const tank = this.tank;
    const v = velocity(tank.direction);
    const total = Math.trunc(distance(tank.position, target));
    for (let dist = 24; dist <= total; dist += 24) {
      if (map.getTile({ x: tank.position.x + v.dx * dist, y: tank.position.y + v.dy * dist }) === Tile.Steel) return true;
    }
    return false;
  }

  private directionTowardsPlayer(playerTanks: Tank[]): Direction | null {
    const tank = this.tank;
    let closest: Tank | null = null;
    let closestDistance = Infinity;
    for (const player of playerTanks) {
      if (!player.isAlive) continue;
      const d = distance(tank.position, player.position);
      if (d < closestDistance) {
        closestDistance = d;
        closest = player;
      }
    }
    if (!closest) return null;
    const dx = closest.position.x - tank.position.x;
    const dy = closest.position.y - tank.position.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Direction.Right : Direction.Left;
    return dy > 0 ? Direction.Up : Direction.Down;
  }

  // MARK: - Gzhel friend brain

  /**
   * Smarter behavior for the Gzhel friend: dodges or shoots down incoming bullets, aims at enemies
   * in a clear line, defends the base first, and finds its way to enemies (shooting through bricks).
   */
  updateFriend(map: GameMap, enemies: Tank[], allTanks: Tank[], enemyBullets: Bullet[]): AIDecision {
    const tank = this.tank;
    if (!tank.isAlive) return NONE;
    if (this.shotAtWallTimer > 0) this.shotAtWallTimer -= 1;

    // Stuck: wander a moment, then plan again
    if (distance(tank.position, this.lastPosition) < 0.3) {
      this.stuckTimer += 1;
      if (this.stuckTimer > 25) {
        this.friendWanderDirection = this.findOpenDirection(map, allTanks, tank.direction);
        this.friendWanderTimer = 30;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPosition = { ...tank.position };

    // 1. Incoming bullet: shoot it down if possible, otherwise sidestep
    const bullet = this.incomingBullet(enemyBullets);
    if (bullet) {
      const facing = opposite(bullet.direction);
      if (!bullet.isLaser && tank.canShoot) {
        tank.turn(facing);
        return decision(null, true);
      }
      for (const side of shuffled([turnedLeft(facing), turnedRight(facing)])) {
        if (!this.isDirectionBlocked(side, map, allTanks)) return decision(side, false);
      }
    }

    const alive = enemies.filter((e) => e.isAlive);

    // 2. An enemy in a clear straight line: face it and fire (hold position when close)
    const shot = this.clearShot(alive, map);
    if (shot) {
      const [direction, dist] = shot;
      tank.turn(direction);
      const advance = dist >= 140 && !this.isDirectionBlocked(direction, map, allTanks);
      return decision(advance ? direction : null, true);
    }

    if (this.friendWanderTimer > 0) {
      this.friendWanderTimer -= 1;
      return decision(this.friendWanderDirection, false);
    }

    // 3. Go after the enemy closest to the base if one is near it, else the nearest one;
    //    with no enemies around, guard the area in front of the base
    let target: Point;
    const nearBase = alive.filter((e) => distance(e.position, BASE_POSITION) < 260);
    if (nearBase.length) {
      target = nearBase.reduce((a, b) => (distance(b.position, BASE_POSITION) < distance(a.position, BASE_POSITION) ? b : a)).position;
    } else if (alive.length) {
      target = alive.reduce((a, b) => (distance(b.position, tank.position) < distance(a.position, tank.position) ? b : a)).position;
    } else {
      target = tileCenter(C.mapHeight - 9, Math.floor(C.mapWidth / 2));
    }

    this.friendRouteTimer -= 1;
    if (this.friendRouteTimer <= 0 || !this.friendRoute.length) {
      this.friendRoute = this.buildRoute(target, map);
      this.friendRouteTimer = 15;
    }

    const [row, col] = tileOf(tank.position);
    if (row < 0 || row >= this.friendRoute.length || col < 0 || col >= this.friendRoute[row].length) return NONE;
    const here = this.friendRoute[row][col];
    if (here === 0) return NONE; // Arrived: wait here

    const step = this.bestStep(row, col, here);
    if (!step) return decision(this.findOpenDirection(map, allTanks, null), false);
    return this.driveOrOpen(step, row, col, map);
  }

  /** Level cleared: pick up reachable power-ups (nearest first), then park in front of the base */
  updateFriendLevelCleared(map: GameMap, powerUps: Point[]): AIDecision {
    const tank = this.tank;
    if (!tank.isAlive) return NONE;
    if (this.shotAtWallTimer > 0) this.shotAtWallTimer -= 1;
    const [row, col] = tileOf(tank.position);

    this.friendRouteTimer -= 1;
    if (this.friendRouteTimer <= 0 || !this.friendRoute.length) {
      this.friendRouteTimer = 15;
      this.friendGoingHome = true;
      this.friendRoute = [];
      const sorted = [...powerUps].sort((a, b) => distance(a, tank.position) - distance(b, tank.position));
      for (const point of sorted) {
        const route = this.buildRoute(point, map);
        if (routeDistance(route, row, col) < UNREACHABLE) {
          this.friendRoute = route;
          this.friendGoingHome = false;
          break;
        }
      }
      if (this.friendGoingHome) this.friendRoute = this.buildRoute(HOME_SPOT, map);
    }

    const here = routeDistance(this.friendRoute, row, col);
    if (here === 0) {
      if (this.friendGoingHome) {
        if (tank.direction !== Direction.Up) tank.turn(Direction.Up); // Home: stop, facing the field
      } else {
        this.friendRouteTimer = 0; // On the power-up tile: choose the next target
      }
      return NONE;
    }
    const step = here < UNREACHABLE ? this.bestStep(row, col, here) : null;
    if (!step) return NONE;
    if (this.friendGoingHome) {
      // Never shoot on the way home; a brick in the way means park right here
      const [dr, dc] = tileStep(step);
      if (map.getTile(tileCenter(row + dr, col + dc)) === Tile.Brick) return NONE;
      return decision(step, false);
    }
    return this.driveOrOpen(step, row, col, map);
  }

  private bestStep(row: number, col: number, here: number): Direction | null {
    let best: Direction | null = null;
    let bestDistance = here;
    for (const direction of ALL_DIRECTIONS) {
      const [dr, dc] = tileStep(direction);
      const d = routeDistance(this.friendRoute, row + dr, col + dc);
      if (d < bestDistance) {
        best = direction;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Drive one step along the route; a brick wall in the way gets shot open first */
  private driveOrOpen(direction: Direction, row: number, col: number, map: GameMap): AIDecision {
    const tank = this.tank;
    const [dr, dc] = tileStep(direction);
    if (map.getTile(tileCenter(row + dr, col + dc)) === Tile.Brick) {
      tank.turn(direction);
      if (this.shotAtWallTimer === 0 && tank.canShoot) {
        this.shotAtWallTimer = 20;
        return decision(null, true);
      }
      return NONE;
    }
    return decision(direction, false);
  }

  /**
   * Distance (in steps) from every tile to the target. Open ground costs 1, bricks cost 4
   * (they have to be shot first), steel and the base walls can't be crossed.
   */
  private buildRoute(target: Point, map: GameMap): number[][] {
    const tank = this.tank;
    const rows = C.mapHeight;
    const cols = C.mapWidth;
    const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(UNREACHABLE));
    const [targetRow, targetCol] = tileOf(target);
    if (targetRow < 0 || targetRow >= rows || targetCol < 0 || targetCol >= cols) return dist;

    const cost = (row: number, col: number): number | null => {
      if (isBaseWall(row, col)) return null;
      switch (map.getTile(tileCenter(row, col))) {
        case Tile.Water:
          return tank.canMoveOnWater ? 1 : null;
        case Tile.Brick:
          return 4;
        case Tile.Steel:
          return null;
        default:
          return 1;
      }
    };

    dist[targetRow][targetCol] = 0;
    const frontier: [number, number, number][] = [[0, targetRow, targetCol]];
    while (frontier.length) {
      let index = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[index][0]) index = i;
      const [d, row, col] = frontier.splice(index, 1)[0];
      if (d !== dist[row][col]) continue;
      // Cost of the tile we come from (the route runs from the friend to the target)
      const stepCost = row === targetRow && col === targetCol ? 1 : (cost(row, col) ?? 1);
      for (const direction of ALL_DIRECTIONS) {
        const [dr, dc] = tileStep(direction);
        const r = row + dr;
        const c = col + dc;
        if (r < 1 || r >= rows - 1 || c < 1 || c >= cols - 1 || cost(r, c) === null) continue;
        const next = d + stepCost;
        if (next < dist[r][c]) {
          dist[r][c] = next;
          frontier.push([next, r, c]);
        }
      }
    }
    return dist;
  }

  /** An enemy straight up/down/left/right with nothing in the way the bullet can't pass */
  private clearShot(enemies: Tank[], map: GameMap): [Direction, number] | null {
    const tank = this.tank;
    let best: [Direction, number] | null = null;
    for (const enemy of enemies) {
      const dx = enemy.position.x - tank.position.x;
      const dy = enemy.position.y - tank.position.y;
      const reach = enemy.size.width / 2 + 2;
      let direction: Direction;
      let dist: number;
      if (Math.abs(dx) < reach && Math.abs(dy) < 420) {
        direction = dy > 0 ? Direction.Up : Direction.Down;
        dist = Math.abs(dy);
      } else if (Math.abs(dy) < reach && Math.abs(dx) < 420) {
        direction = dx > 0 ? Direction.Right : Direction.Left;
        dist = Math.abs(dx);
      } else {
        continue;
      }
      if (!this.isLineClear(tank.position, direction, dist, map)) continue;
      if (dist < (best?.[1] ?? Infinity)) best = [direction, dist];
    }
    return best;
  }

  /** Steel (without GUN) or the base walls stop the shot; bricks just get shot through */
  private isLineClear(start: Point, direction: Direction, dist: number, map: GameMap): boolean {
    const tank = this.tank;
    const v = velocity(direction);
    let travelled = tank.size.width / 2;
    while (travelled < dist - 8) {
      const point = { x: start.x + v.dx * travelled, y: start.y + v.dy * travelled };
      const [row, col] = tileOf(point);
      if (isBaseWall(row, col)) return false;
      if (map.getTile(point) === Tile.Steel && tank.bulletPower < 2) return false;
      travelled += 8;
    }
    return true;
  }

  /** The closest enemy bullet that will hit the friend soon */
  private incomingBullet(bullets: Bullet[]): Bullet | null {
    const tank = this.tank;
    let closest: Bullet | null = null;
    let closestAhead = Infinity;
    for (const bullet of bullets) {
      const v = velocity(bullet.direction);
      const rx = tank.position.x - bullet.position.x;
      const ry = tank.position.y - bullet.position.y;
      const ahead = rx * v.dx + ry * v.dy;
      const aside = Math.abs(rx * v.dy - ry * v.dx);
      if (!(ahead > 0 && ahead < 150 && aside < tank.size.width / 2 + 4)) continue;
      if (ahead < closestAhead) {
        closest = bullet;
        closestAhead = ahead;
      }
    }
    return closest;
  }
}
