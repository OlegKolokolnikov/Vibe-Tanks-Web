import type { Point } from "../engine/geometry";

export enum EnemyType {
  Regular = 0,
  Fast = 1,
  Armored = 2,
  Power = 3,
  Heavy = 4,
  Boss = 5,
  /** Small alien (alien mode only): swims, drops the laser power-up */
  Alien = 6,
  /** "Friend" (Gzhel mode ally): hunts enemies, harmless to the player, survives 3 enemy hits */
  Gzhel = 7,
}

/** Game constants (ported from the iOS / Java versions) */
export const C = {
  // Map dimensions (in tiles)
  mapWidth: 26,
  mapHeight: 26,
  tileSize: 32,

  // Sidebar (like original Battle City)
  sidebarWidth: 64,

  get gameWidth(): number {
    return this.mapWidth * this.tileSize;
  },
  get gameHeight(): number {
    return this.mapHeight * this.tileSize;
  },

  // Tank properties
  tankSize: 28,
  tankSpeed: 2.0,
  enemyTankSpeed: 1.5,
  bossTankSize: 28, // Same size as other tanks so it fits every corridor
  alienSize: 22, // Small alien enemy (alien mode)

  // Bullet properties
  bulletSize: 8,
  bulletSpeed: 6.0,
  maxBulletsPerTank: 2,
  laserSpeed: 16.0, // LASER shots: light, much faster than bullets
  friendHits: 3, // Enemy hits the Gzhel friend survives (+1 per extra-life power-up)
  laserRoundsOnPickup: 1, // Laser lasts until death or the end of the round

  // Spawn settings
  totalEnemies: 20,
  maxEnemiesOnScreen: 5,
  spawnDelay: 50, // frames (~0.8 seconds)

  // Boss settings
  bossBaseHealth: 10,
  bossLevelInterval: 10, // Boss is the last tank of every 10th level
  fireBoostStep: 5, // Frames off the shot cooldown per star / defeated boss
  bossesPerExtraBullet: 3, // Every 3rd defeated boss adds a bullet per shot
  gzhelLevelsForBonusStage: 5, // Gzhel levels in a row before the secret Gorodets stage
  magicChance: 0.02, // MAGIC: 2% of random drops on normal levels
  magicChanceBonusStage: 0.12, // 12% on the bonus stage
  magicGuaranteeEnemiesLeft: 10, // Bonus stage: forced once this few enemies are left
  mysteryPrizeCount: 3, // Power-ups inside the boss's question mark
  startingContinues: 3, // Continues per game; every defeated boss adds one
  enemySpeedPerBoss: 0.1, // Enemies are 10% faster per defeated boss
  enemyMaxBossSpeed: 1.6, // ...up to 1.6x

  victoryDelay: 300, // 5 seconds at 60fps
  respawnDelay: 60, // 1 second

  // Shield duration
  shieldDuration: 3600, // 1 minute (full shield power-up)
  temporaryShieldDuration: 180, // 3 seconds (respawn/start)

  powerUpLifetime: 600, // 10 seconds

  // Level-clear bonuses
  strawberryScoreThreshold: 250,
  bananaScoreThreshold: 500,
  strawberryPoints: 50,
  bananaPoints: 75,
  ballPoints: 90,
  watermelonPoints: 55,
  icecreamPoints: 33,
  watermelonTimeLimit: 3600, // Level won within 1 minute (frames)
  ballSpeedBoost: 0.15, // Start speed per ball
  ballMaxBaseSpeed: 1.6, // Start speed cap
  levelBonusVictoryDelay: 720, // 12 seconds to grab the bonuses
  freezeTime: 600,
  freezeDuration: 1800, // 30 seconds (freeze power-up effect)
  // How long players stay frozen when an enemy takes the freeze power-up (frames)
  playerFreezeNormal: 1200, // 20 seconds
  playerFreezeEasy: 600, // 10 seconds
  playerFreezeSpecial: 900, // 15 seconds (Gzhel and alien levels)
  baseProtectionTime: 3600, // 1 minute (shovel power-up)

  // UFO settings
  ufoLifetime: 1800, // 30 seconds
  ufoShootCooldown: 90, // frames between shots
  ufoSpawnChance: 0.003, // ~5.5 seconds average at 60 FPS
  ufoMessageDuration: 180, // 3 seconds
  ufoKillsRequired: 5, // kills needed before UFO can spawn

  // Easter Egg settings
  easterEggLifetime: 600, // 10 seconds
  easterEggLivesBonus: 3, // extra lives when player collects
  cheeseLivesBonus: 11, // extra lives from the cheese on the boss bonus stage
};

/** Player 1 spawn / respawn point; player 2 mirrors it on the right side of the base */
export function spawnPosition(player: number): Point {
  return player === 2 ? { x: C.tileSize * 19, y: C.tileSize * 2 } : { x: C.tileSize * 8, y: C.tileSize * 2 };
}

export function scoreForEnemyType(type: EnemyType): number {
  switch (type) {
    case EnemyType.Regular:
      return 1;
    case EnemyType.Fast:
      return 2;
    case EnemyType.Armored:
      return 3;
    case EnemyType.Power:
      return 4;
    case EnemyType.Heavy:
      return 5;
    case EnemyType.Boss:
      return 10;
    case EnemyType.Alien:
      return 5;
    case EnemyType.Gzhel:
      return 0; // Ally, never scored
  }
}

/** Axis-aligned overlap test for two squares (matches tank movement collision) */
export function boxesOverlap(p1: Point, size1: number, p2: Point, size2: number): boolean {
  const minDist = (size1 + size2) / 2;
  return Math.abs(p1.x - p2.x) < minDist && Math.abs(p1.y - p2.y) < minDist;
}
