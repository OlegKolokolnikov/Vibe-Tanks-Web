import { randomElement, shuffled, type Point } from "../engine/geometry";
import { C, EnemyType, boxesOverlap } from "./constants";
import { Direction } from "./direction";
import type { GameMap } from "./map";
import { GameState } from "./state";
import { Tank } from "./tank";

const OTHER_TYPES = [EnemyType.Regular, EnemyType.Fast, EnemyType.Armored, EnemyType.Power];

/** Handles spawning of enemy tanks */
export class EnemySpawner {
  private spawnedCount = 0;
  private spawnCooldown = C.spawnDelay;
  /** Pre-planned enemy types for a guaranteed distribution */
  private readonly plannedEnemyTypes: EnemyType[];
  /** Spawn positions (top of the map) */
  private readonly spawnPositions: Point[];
  /** Extra enemies from the tank power-up (spawned separately, don't affect the boss) */
  private extraEnemiesToSpawn = 0;

  constructor(
    private readonly totalEnemies: number,
    private readonly maxOnScreen: number,
    /** Every 10th level: the last planned tank is the boss */
    private readonly hasBoss = false,
  ) {
    const ts = C.tileSize;
    const y = (C.mapHeight - 2) * ts;
    this.spawnPositions = [
      { x: ts * 2, y },
      { x: Math.floor(C.mapWidth / 2) * ts, y },
      { x: (C.mapWidth - 2) * ts, y },
    ];
    this.plannedEnemyTypes = this.planEnemyTypes(totalEnemies);
  }

  /**
   * Plan enemy types with guaranteed heavy and power counts.
   * Alien mode: 10 heavy, 5 power. Easy mode: 3 heavy, 10 power. Normal: 5 heavy, 5 power.
   */
  private planEnemyTypes(total: number): EnemyType[] {
    let heavyCount: number;
    let powerCount: number;
    if (GameState.isAlienModeActive) {
      heavyCount = 10;
      powerCount = 5;
    } else if (GameState.isEasyMode) {
      heavyCount = 3;
      powerCount = 10;
    } else {
      heavyCount = 5;
      powerCount = 5;
    }

    // Very short levels still fit
    const heavyFit = Math.min(heavyCount, total);
    const powerFit = Math.min(powerCount, total - heavyFit);
    const types: EnemyType[] = [];
    for (let i = 0; i < heavyFit; i++) types.push(EnemyType.Heavy);
    for (let i = 0; i < powerFit; i++) types.push(EnemyType.Power);
    for (let i = 0; i < total - heavyFit - powerFit; i++) types.push(randomElement(OTHER_TYPES) ?? EnemyType.Regular);

    // Shuffle, but heavy tanks go in the last third
    const heavy = types.filter((t) => t === EnemyType.Heavy);
    let result: EnemyType[] = shuffled(types.filter((t) => t !== EnemyType.Heavy));
    heavy.forEach((heavyTank, index) => {
      const insertPos = result.length - (heavy.length - index - 1);
      result.splice(Math.max(insertPos, Math.floor((result.length * 2) / 3)), 0, heavyTank);
    });

    // Alien mode: one random heavy tank is replaced by the small alien
    if (GameState.isAlienModeActive) {
      const heavyIndices = result.map((t, i) => (t === EnemyType.Heavy ? i : -1)).filter((i) => i >= 0);
      const alienIndex = randomElement(heavyIndices);
      if (alienIndex !== undefined) result[alienIndex] = EnemyType.Alien;
    }

    // Secret Gorodets bonus stage: every tank is a rainbow POWER bird (the alien stays itself)
    if (GameState.isBirdStage) result = result.map((t) => (t === EnemyType.Alien ? EnemyType.Alien : EnemyType.Power));

    // Boss level: the very last tank is the boss
    if (this.hasBoss && result.length) result[result.length - 1] = EnemyType.Boss;
    return result;
  }

  update(existingEnemies: Tank[], playerTank: Tank | null, map: GameMap, otherTanks: Tank[] = []): Tank | null {
    if (this.spawnedCount >= this.totalEnemies) return null;
    if (existingEnemies.length >= this.maxOnScreen) return null;
    this.spawnCooldown -= 1;
    if (this.spawnCooldown > 0) return null;
    this.spawnCooldown = C.spawnDelay;

    const type = this.spawnedCount < this.plannedEnemyTypes.length ? this.plannedEnemyTypes[this.spawnedCount] : EnemyType.Regular;
    const position = this.findValidSpawnPosition(type, existingEnemies, playerTank, map, otherTanks);
    if (!position) return null;
    this.spawnedCount += 1;
    return new Tank(position, Direction.Down, false, 0, type);
  }

  private findValidSpawnPosition(type: EnemyType, existingEnemies: Tank[], playerTank: Tank | null, map: GameMap, otherTanks: Tank[]): Point | null {
    // Heavy tanks use the side spawns and take the center only when both sides are blocked
    const candidates =
      type === EnemyType.Heavy ? [...shuffled([this.spawnPositions[0], this.spawnPositions[2]]), this.spawnPositions[1]] : shuffled(this.spawnPositions);
    const blockers = [...existingEnemies, ...otherTanks];
    for (const pos of candidates) {
      if (this.isPositionValid(pos, C.tankSize, blockers, playerTank, map)) return { ...pos };
    }
    return null;
  }

  private isPositionValid(position: Point, tankSize: number, tanks: Tank[], playerTank: Tank | null, map: GameMap): boolean {
    // Same axis-aligned box test as tank movement (overlapping tanks could never move apart)
    for (const tank of tanks) {
      if (tank.isAlive && boxesOverlap(position, tankSize, tank.position, tank.size.width)) return false;
    }
    if (playerTank?.isAlive && boxesOverlap(position, tankSize, playerTank.position, playerTank.size.width)) return false;
    return !map.checkTankCollision(position, tankSize);
  }

  allEnemiesDefeated(currentEnemies: Tank[]): boolean {
    return this.spawnedCount >= this.totalEnemies && currentEnemies.length === 0 && this.extraEnemiesToSpawn === 0;
  }

  get remainingEnemies(): number {
    return this.totalEnemies - this.spawnedCount + this.extraEnemiesToSpawn;
  }

  /** Queue an extra enemy (an enemy collected the tank power-up) */
  addExtraEnemy(): void {
    this.extraEnemiesToSpawn += 1;
  }

  spawnExtraEnemy(existingEnemies: Tank[], playerTank: Tank | null, map: GameMap, otherTanks: Tank[] = []): Tank | null {
    if (this.extraEnemiesToSpawn <= 0 || existingEnemies.length >= this.maxOnScreen) return null;
    const type = randomElement(OTHER_TYPES) ?? EnemyType.Regular;
    const position = this.findValidSpawnPosition(type, existingEnemies, playerTank, map, otherTanks);
    if (!position) return null;
    this.extraEnemiesToSpawn -= 1;
    return new Tank(position, Direction.Down, false, 0, type);
  }
}
