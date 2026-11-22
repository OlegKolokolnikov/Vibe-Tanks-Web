import { Action } from "../engine/actions";
import { Colors, hsb, rgb, white, withAlpha, type Color } from "../engine/color";
import { stroke, fill, fillEllipse } from "../engine/draw";
import { distance, randomElement, randomIn, randomInt, type Point, type Size } from "../engine/geometry";
import { LabelNode, Node, ShapeNode, SpriteNode, makeTexture, type Texture } from "../engine/node";
import { Path } from "../engine/path";
import { Scene, type Touch } from "../engine/scene";
import type { View } from "../engine/view";
import { Base, type Resident } from "./base";
import { makeGorodetsBorder, makeGzhelBorder, makeKhokhlomaBorder } from "./borders";
import type { Bullet } from "./bullet";
import { CheatSettings } from "./cheatSettings";
import { C, EnemyType, boxesOverlap, scoreForEnemyType, spawnPosition } from "./constants";
import { Direction } from "./direction";
import { EasterEgg } from "./easterEgg";
import { EnemySpawner } from "./enemySpawner";
import { GameMap, Tile } from "./map";
import { MenuScene } from "./menuScene";
import { PowerUp, PowerUpType, iconForType } from "./powerUp";
import { GameSettings, KEY_ACTIONS, KeyActionInfo, tankColorOf } from "./settings";
import { Sidebar, emptyPowerUpData, type PowerUpData } from "./sidebar";
import { SoundManager } from "./sound";
import { GameState } from "./state";
import { Tank } from "./tank";
import { TouchController } from "./touchController";
import { UFO } from "./ufo";

/** Power-ups carried across levels */
export interface PlayerPowerUps {
  starCount: number;
  machinegunCount: number;
  bulletPower: number;
  speedMultiplier: number;
  canSwim: boolean;
  canDestroyTrees: boolean;
  /** LASER: rounds left including the one being started */
  laserRounds: number;
  /** Soccer-ball start speed (until a new game) */
  baseSpeedMultiplier: number;
  /** Faster shooting from defeated bosses (until a new game) */
  bossFireBoost: number;
  /** Cheats: MAGIC from the start */
  hasMagic: boolean;
  /** Cheats: one-minute shield at the start */
  shield: boolean;
}

export function defaultPowerUps(): PlayerPowerUps {
  return {
    starCount: 0,
    machinegunCount: 0,
    bulletPower: 1,
    speedMultiplier: 1,
    canSwim: false,
    canDestroyTrees: false,
    laserRounds: 0,
    baseSpeedMultiplier: 1,
    bossFireBoost: 0,
    hasMagic: false,
    shield: false,
  };
}

/** Friend's state carried into the next level */
export interface FriendCarry {
  health: number;
  maxHealth: number;
  starCount: number;
  machinegunCount: number;
  bulletPower: number;
  speedMultiplier: number;
  canSwim: boolean;
  canDestroyTrees: boolean;
}

export interface GameSceneOptions {
  level?: number;
  score?: number;
  lives?: number;
  sessionSeed?: number;
  powerUps?: PlayerPowerUps;
  gzhelBorder?: boolean;
  alienMode?: boolean;
  playerCount?: number;
  player2Lives?: number;
  player2PowerUps?: PlayerPowerUps;
  player2Score?: number;
  friend?: FriendCarry | null;
  gzhelStreak?: number;
  bonusStage?: boolean;
  continues?: number;
  /** Cheats: base starts behind steel */
  startSteelBase?: boolean;
}

/** What the desktop HTML overlay shows (score line, white plate on Gzhel / bonus levels) */
export interface HudInfo {
  text: string;
  plate: boolean;
}

type KillCounts = Map<EnemyType, number>;

interface KillBonus {
  playerIndex: number;
  type: PowerUpType;
}

const FRIEND_BLUE = rgb(0.3, 0.55, 1.0);
const MAGIC_COLOR = rgb(0.75, 0.45, 1.0);
const BUTTON_WIDTH = 180;
const BUTTON_HEIGHT = 45;

/** Easy mode: after 3 consecutive losses */
let consecutiveLosses = 0;
function setConsecutiveLosses(value: number): void {
  consecutiveLosses = value;
  GameState.isEasyMode = consecutiveLosses >= 3;
}

let lightningBoltTexture: Texture | null = null;
let spawnFlashTexture: Texture | null = null;

function getLightningBoltTexture(): Texture {
  lightningBoltTexture ??= makeTexture(20, 35, (ctx) => {
    stroke(ctx, Colors.cyan, 2);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(10, 5);
    for (const [x, y] of [
      [13, 12],
      [8, 18],
      [14, 28],
      [9, 22],
      [12, 15],
      [7, 8],
    ]) {
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  return lightningBoltTexture;
}

function getSpawnFlashTexture(): Texture {
  spawnFlashTexture ??= makeTexture(40, 40, (ctx) => {
    const center = 20;
    fill(ctx, withAlpha(Colors.cyan, 0.3));
    fillEllipse(ctx, center - 18, center - 18, 36, 36);
    fill(ctx, Colors.white);
    fillEllipse(ctx, center - 15, center - 15, 30, 30);
  });
  return spawnFlashTexture;
}

function now(): number {
  return performance.now() / 1000;
}

function sumKills(kills: KillCounts): number {
  let total = 0;
  for (const v of kills.values()) total += v;
  return total;
}

function label(text: string, fontSize: number, color: Color, options: { v?: LabelNode["verticalAlignmentMode"]; h?: LabelNode["horizontalAlignmentMode"] } = {}): LabelNode {
  const node = new LabelNode(text, "Helvetica-Bold");
  node.fontSize = fontSize;
  node.fontColor = color;
  if (options.v) node.verticalAlignmentMode = options.v;
  if (options.h) node.horizontalAlignmentMode = options.h;
  return node;
}

/** Main game scene */
export class GameScene extends Scene {
  /** Desktop HTML overlay: score text (null when the game scene goes away) */
  static hudListener: ((info: HudInfo | null) => void) | null = null;

  /** Bonus lives earned with this score: at 100, 250, 450, 700, 1000, then one every 1000 (2000, 3000...) */
  static lifeMilestones(score: number): number {
    const early = [100, 250, 450, 700, 1000].filter((s) => score >= s).length;
    return score >= 1000 ? early + Math.floor(score / 1000) - 1 : early;
  }

  // Game objects
  gameMap!: GameMap;
  playerTank!: Tank;
  player2Tank: Tank | null = null;
  readonly playerCount: number;
  get isTwoPlayer(): boolean {
    return this.playerCount === 2;
  }
  get playerTanks(): Tank[] {
    return this.player2Tank ? [this.playerTank, this.player2Tank] : [this.playerTank];
  }
  enemyTanks: Tank[] = [];
  private cachedAllTanks: Tank[] = [];
  private allTanksDirty = true;
  bullets: Bullet[] = [];
  private bulletsMarkedForRemoval = new Set<Bullet>();
  powerUps: PowerUp[] = [];
  base!: Base;

  ufos: UFO[] = [];
  /** Crazy mode: UFOs still to come this level */
  private crazyUFOsLeft = 0;
  easterEgg: EasterEgg | null = null;
  ufoSpawnedThisLevel = false;
  ufoWasKilled = false;
  playerCollectedEasterEgg = false;
  playerKills = 0;
  private ufoMessageTimer = 0;
  private goldSpawnedThisLevel = false;
  private goldSpawnTimer = 0;
  private readonly goldSpawnChance = 0.0003;
  /** Cheese (boss bonus stage only, once): frame of the level it appears on, null for none */
  private cheeseSpawnFrame: number | null = null;
  private cheeseFrameCounter = 0;
  /** Cheese taken: the base can't be destroyed until the level ends */
  private baseInvincible = false;
  private ufoMessageLabel: LabelNode | null = null;

  /** Friends (Gzhel tanks): the Gzhel / returning friend, or a crowd in crazy mode */
  friends: Tank[] = [];
  private returningFriend: FriendCarry | null;
  private friendLivesLabels = new Map<Tank, LabelNode>();
  /** Friends still to appear this level, each at its frame */
  private pendingFriends: { carry: FriendCarry | null; hits: number | null; frame: number }[] = [];
  private gzhelFrameCounter = 0;
  private readonly startSteelBase: boolean;

  // UI
  touchController!: TouchController;
  touchController2: TouchController | null = null;
  sidebar!: Sidebar;
  private scoreLabel: LabelNode | null = null;
  private quietEffects = false;
  private scorePlate: ShapeNode | null = null;
  private lastHudText = "";

  // Game state
  scores: number[];
  get score(): number {
    return this.scores[0];
  }
  private get bestScore(): number {
    return Math.max(...this.scores.slice(0, this.playerCount));
  }
  level: number;
  private readonly sessionSeed: number;
  private continues: number;
  isGameOver = false;
  isGamePaused = false;
  didWinLevel = false;

  private levelStartScores: number[] = [0, 0];
  killsByType: KillCounts = new Map();
  killsByPlayer: KillCounts[] = [new Map(), new Map()];

  freezeTimer = 0;
  playerFreezeTimers = [0, 0];
  private victoryDelayTimer = 0;
  private bombUsedThisLevel = false;
  private levelBonusesSpawned = false;

  baseProtectionTimer = 0;
  baseFlashTimer = 0;
  baseIsSteel = false;

  // Keyboard input, indexed by playerNumber - 1
  private keyboardDirection: (Direction | null)[] = [null, null];
  private keyboardFiring = [false, false];
  private readonly pressedDirectionKeys = new Set<string>();
  private keyMap: Map<string, { player: number; direction: Direction | null }> | null = null;
  private firingLastFrame = [false, false];

  private enemySpawner!: EnemySpawner;
  private readonly gameCamera = new Node();
  gameLayer = new Node();

  private readonly initialLives: number;
  private readonly initialLives2: number;
  private readonly initialPowerUps: PlayerPowerUps;
  private readonly initialPowerUps2: PlayerPowerUps;

  private readonly showGzhelBorder: boolean;
  private readonly alienMode: boolean;
  private baseResident: Resident = { kind: "cat" };
  private magicSpawnedThisLevel = false;
  private readonly gzhelStreak: number;
  private readonly bonusStage: boolean;
  private ufoEscapedThisLevel = false;

  private bossHealthBar: Node | null = null;
  private pauseOverlay: Node | null = null;
  private endScreenInputUnlockTime = 0;
  private isNewHighScore = false;
  private gameOverScreen: Node | null = null;
  /** Buttons on the camera that react to taps, by name */
  private buttons = new Map<string, Node>();

  private playerFreezeLabels: LabelNode[] = [];
  private enemyFreezeLabel: LabelNode | null = null;
  private shownPlayerFreezeSeconds = [-1, -1];
  private shownEnemyFreezeSeconds = -1;
  private lifeHintLabels: LabelNode[] = [];

  /** Touches owned by a touch controller */
  private readonly controllerTouches = new Map<number, TouchController>();

  constructor(size: Size, options: GameSceneOptions = {}) {
    super(size);
    this.continues = options.continues ?? C.startingContinues;
    this.startSteelBase = options.startSteelBase ?? false;
    this.returningFriend = options.friend ?? null;
    this.gzhelStreak = options.gzhelStreak ?? 0;
    this.bonusStage = options.bonusStage ?? false;
    this.level = options.level ?? 1;
    this.scores = [options.score ?? 0, options.player2Score ?? 0];
    this.initialLives = options.lives ?? 3;
    this.initialPowerUps = options.powerUps ?? defaultPowerUps();
    this.playerCount = options.playerCount === 2 ? 2 : 1;
    this.initialLives2 = options.player2Lives ?? 3;
    this.initialPowerUps2 = options.player2PowerUps ?? defaultPowerUps();
    this.showGzhelBorder = options.gzhelBorder ?? false;
    this.alienMode = options.alienMode ?? false;
    this.sessionSeed = options.sessionSeed || randomInt(1, 2 ** 31 - 1);
  }

  private get cs(): number {
    return this.cameraZoom;
  }

  private get enemySpeedFactor(): number {
    const bosses = Math.max(...this.playerTanks.map((p) => p.bossFireBoost), 0);
    return Math.min(1 + bosses * C.enemySpeedPerBoss, C.enemyMaxBossSpeed);
  }

  // MARK: - Lifecycle

  didMove(_view: View): void {
    this.backgroundColor = Colors.black;
    this.camera = this.gameCamera;
    this.addChild(this.gameCamera);
    this.setupGame();
    this.setupUI();
    if (this.bonusStage) this.showUFOMessage("✨ SECRET BONUS STAGE! ✨", rgb(1.0, 0.55, 0.1));
    else if (CheatSettings.isCrazy) this.showUFOMessage("🤪 CRAZY MODE! 🤪", Colors.magenta);
    if (this.startSteelBase) this.activateBaseProtection();
    SoundManager.playIntro();
  }

  willMove(_view: View): void {
    GameScene.hudListener?.(null);
  }

  willResignActive(): void {
    this.resetKeyboardInput();
    this.releaseControllerTouches();
    if (!this.isGameOver && !this.isGamePaused) this.togglePause();
  }

  /** Pause button of the desktop overlay */
  requestPause(): void {
    if (!this.isGameOver) this.togglePause();
  }

  private resetKeyboardInput(): void {
    this.pressedDirectionKeys.clear();
    this.keyboardDirection = [null, null];
    this.keyboardFiring = [false, false];
  }

  private releaseControllerTouches(): void {
    this.controllerTouches.clear();
    this.touchController.releaseAll();
    this.touchController2?.releaseAll();
  }

  // MARK: - Setup

  private setupGame(): void {
    this.levelStartScores = [...this.scores];
    this.killsByType = new Map();
    this.killsByPlayer = [new Map(), new Map()];

    this.addChild(this.gameLayer);

    GameState.isGzhelActive = this.showGzhelBorder;
    GameState.isAlienModeActive = this.alienMode;
    GameState.isBirdStage = this.bonusStage;
    GameState.isEasyMode = consecutiveLosses >= 3;
    if (this.bonusStage) this.gameLayer.addChild(makeGorodetsBorder());
    else if (this.showGzhelBorder) this.gameLayer.addChild(makeGzhelBorder());
    else if (this.alienMode) this.gameLayer.addChild(makeKhokhlomaBorder());

    // Session seed + level: deterministic but unique per game session
    const mapSeed = (this.sessionSeed + this.level * 12345) >>> 0;
    this.gameMap = new GameMap(this.level, mapSeed, this.isTwoPlayer);
    GameState.currentMap = this.gameMap;
    this.gameLayer.addChild(this.gameMap);

    const mapSize = this.gameMap.pixelSize;
    this.sidebar = new Sidebar(mapSize.height, this.isTwoPlayer);
    this.sidebar.position = { x: mapSize.width, y: 0 };
    this.gameLayer.addChild(this.sidebar);

    // Center the camera on the map + sidebar and fit them on the screen
    const totalWidth = mapSize.width + C.sidebarWidth;
    this.gameCamera.position = { x: totalWidth / 2, y: mapSize.height / 2 };
    const scale = Math.min(this.size.width / totalWidth, this.size.height / mapSize.height) * 0.95;
    this.cameraZoom = 1 / scale;

    // Base in col 13, row 24 (matching the protection gap)
    const basePosition = { x: 13 * C.tileSize + C.tileSize / 2, y: (C.mapHeight - 1 - 24) * C.tileSize + C.tileSize / 2 };
    const isBossLevel = this.level % C.bossLevelInterval === 0;
    let resident: Resident;
    if (this.bonusStage) {
      resident = isBossLevel ? { kind: "rat" } : { kind: "woman" };
      // The rat's stage hides a cheese that appears somewhere between 10 and 70 seconds in
      if (isBossLevel) this.cheeseSpawnFrame = 600 + Math.floor(Math.random() * 3601);
    }
    else if (this.alienMode) resident = { kind: "alien" };
    else if (isBossLevel) resident = { kind: "dog" };
    else resident = { kind: "cat" };
    this.baseResident = resident;
    this.base = new Base(basePosition, resident);
    this.gameLayer.addChild(this.base);

    this.playerTank = this.makePlayerTank(1, this.initialLives, this.initialPowerUps);
    if (this.isTwoPlayer) this.player2Tank = this.makePlayerTank(2, this.initialLives2, this.initialPowerUps2);

    const cheats = CheatSettings.active;
    let totalEnemies = GameState.isEasyMode ? 18 : Math.min(20 + (this.level - 1) * 2, 50);
    let maxOnScreen = C.maxEnemiesOnScreen;
    let plannedTypes: EnemyType[] | null = null;
    if (cheats.crazyMode) {
      // Crazy mode: up to 1000 enemies of any kind, bosses and aliens included, and a few UFOs
      totalEnemies = randomInt(10, 1000);
      maxOnScreen = randomInt(5, 20);
      plannedTypes = EnemySpawner.crazyEnemyTypes(totalEnemies);
      this.crazyUFOsLeft = randomInt(1, 5);
    } else {
      if (cheats.enemyCount > 0) totalEnemies = cheats.enemyCount;
      if (cheats.enemiesOnScreen > 0) maxOnScreen = cheats.enemiesOnScreen;
    }

    // Returning friend a second after the start; the Gzhel friend 10-40 seconds in
    if (this.returningFriend) this.pendingFriends.push({ carry: this.returningFriend, hits: null, frame: 60 });
    else if (this.showGzhelBorder) this.pendingFriends.push({ carry: null, hits: null, frame: randomInt(600, 2400) });
    // Crazy mode: a random crowd of friends, each with 1-5 hits
    if (cheats.crazyMode) {
      const count = randomInt(1, 6);
      for (let i = 0; i < count; i++) this.pendingFriends.push({ carry: null, hits: randomInt(1, 5), frame: 90 + i * 40 });
    }

    // More tanks on screen: they come in faster
    this.enemySpawner = new EnemySpawner(
      totalEnemies,
      maxOnScreen,
      plannedTypes === null && isBossLevel,
      maxOnScreen > C.maxEnemiesOnScreen ? 20 : C.spawnDelay,
      plannedTypes,
    );
  }

  // MARK: - Cheats

  /** Start a new game from the menu or NEW GAME: cheats set the level, lives and power-ups */
  static newGame(size: Size, playerCount: number): GameScene {
    const cheats = CheatSettings.active;
    return new GameScene(size, {
      level: cheats.startLevel,
      score: 0,
      lives: GameScene.startLives(),
      sessionSeed: randomInt(1, 2 ** 31 - 1),
      powerUps: GameScene.startPowerUps(),
      playerCount,
      player2Lives: GameScene.startLives(),
      player2PowerUps: GameScene.startPowerUps(),
      startSteelBase: cheats.steelBase,
    });
  }

  /** Lives at the start of a game (or a continue): 3, the cheat setting, or crazy 3-99 */
  private static startLives(): number {
    const cheats = CheatSettings.active;
    return cheats.crazyMode ? randomInt(3, 99) : cheats.playerLives;
  }

  /** Power-ups at the start of a game (or a continue), on top of what is kept */
  private static startPowerUps(kept: PlayerPowerUps = defaultPowerUps()): PlayerPowerUps {
    const cheats = CheatSettings.active;
    const p = { ...kept };
    let stars: number, guns: number, cars: number;
    if (cheats.crazyMode) {
      // Crazy mode: a random set every start
      const coin = () => Math.random() < 0.5;
      stars = randomInt(0, 3);
      guns = randomInt(0, 3);
      cars = randomInt(0, 4);
      p.bulletPower = coin() ? 2 : 1;
      p.canSwim = coin();
      p.canDestroyTrees = coin();
      p.laserRounds = randomInt(1, 4) === 1 ? 1 : 0;
      p.hasMagic = coin();
      p.shield = coin();
    } else {
      stars = cheats.stars;
      guns = cheats.machineguns;
      cars = cheats.cars;
      if (cheats.gun) p.bulletPower = 2;
      if (cheats.ship) p.canSwim = true;
      if (cheats.saw) p.canDestroyTrees = true;
      if (cheats.laser) p.laserRounds = 1;
      p.hasMagic = cheats.magic;
      p.shield = cheats.shield;
    }
    p.starCount = Math.max(p.starCount, stars);
    p.machinegunCount = Math.max(p.machinegunCount, guns);
    p.speedMultiplier = Math.min(Math.max(p.speedMultiplier, p.baseSpeedMultiplier + cars * 0.3), 2.5);
    return p;
  }

  /** Cheat speed, fire rate and armor for a new enemy */
  private applyEnemyCheats(enemy: Tank): void {
    const cheats = CheatSettings.active;
    enemy.cheatSpeed = cheats.enemySpeed;
    enemy.cheatFireRate = cheats.enemyFireRate;
    if (cheats.enemyArmor > 0) {
      enemy.health += cheats.enemyArmor;
      enemy.maxHealth += cheats.enemyArmor;
    }
  }

  private makePlayerTank(number: number, lives: number, powerUps: PlayerPowerUps): Tank {
    const tank = new Tank(spawnPosition(number), Direction.Up, true, number);
    tank.lives = lives;
    tank.starCount = powerUps.starCount;
    tank.machinegunCount = powerUps.machinegunCount;
    tank.bulletPower = powerUps.bulletPower;
    tank.speedMultiplier = powerUps.speedMultiplier;
    tank.canSwim = powerUps.canSwim;
    tank.canDestroyTrees = powerUps.canDestroyTrees;
    tank.laserRounds = powerUps.laserRounds;
    tank.baseSpeedMultiplier = powerUps.baseSpeedMultiplier;
    tank.bossFireBoost = powerUps.bossFireBoost;
    tank.hasMagic = powerUps.hasMagic;

    // Cheats: player speed and fire rate (faster shooting also allows more shots in the air)
    const cheats = CheatSettings.active;
    tank.cheatSpeed = cheats.playerSpeed;
    tank.cheatFireRate = cheats.playerFireRate;
    if (cheats.playerFireRate >= 2) tank.maxBullets = C.maxBulletsPerTank + 2;
    else if (cheats.playerFireRate > 1) tank.maxBullets = C.maxBulletsPerTank + 1;

    tank.drawTank();
    if (powerUps.shield) tank.activateShield(C.shieldDuration);
    if (lives <= 0) {
      tank.health = 0;
      tank.isHidden = true;
    }
    this.gameLayer.addChild(tank);
    return tank;
  }

  /** What a player keeps through a death (carried into a continue) */
  private keptAfterDeath(tank: Tank): PlayerPowerUps {
    const p = defaultPowerUps();
    p.bossFireBoost = tank.bossFireBoost;
    p.baseSpeedMultiplier = tank.baseSpeedMultiplier;
    p.speedMultiplier = tank.baseSpeedMultiplier;
    return p;
  }

  private carriedPowerUps(tank: Tank): PlayerPowerUps {
    return {
      starCount: tank.starCount,
      machinegunCount: tank.machinegunCount,
      bulletPower: tank.bulletPower,
      speedMultiplier: tank.speedMultiplier,
      canSwim: tank.canSwim,
      canDestroyTrees: tank.canDestroyTrees,
      baseSpeedMultiplier: tank.baseSpeedMultiplier,
      bossFireBoost: tank.bossFireBoost,
      // Laser ends with the round (a kill-bonus laser carries into the next one)
      laserRounds: Math.max(tank.laserRounds - 1, 0),
      hasMagic: false,
      shield: false,
    };
  }

  private setupUI(): void {
    const cs = this.cs;
    const visibleSize = { width: this.size.width * cs, height: this.size.height * cs };

    this.touchController = new TouchController();
    if (GameState.touchControls) {
      this.touchController.setupForScreen(visibleSize, this.isTwoPlayer ? "leftPlayer" : "single", GameSettings.firePlacement(0));
      this.touchController.setGzhelMode(this.showGzhelBorder);
      this.gameCamera.addChild(this.touchController);

      if (this.isTwoPlayer) {
        this.touchController.setPlayerMarker("1P", tankColorOf(GameSettings.playerTankColor));
        const controller2 = new TouchController();
        controller2.setupForScreen(visibleSize, "rightPlayer", GameSettings.firePlacement(1));
        controller2.setGzhelMode(this.showGzhelBorder);
        controller2.setPlayerMarker("2P", tankColorOf(GameSettings.player2TankColor));
        this.gameCamera.addChild(controller2);
        this.touchController2 = controller2;
      }

      const scoreLabel = label("Score: 0", 18, this.showGzhelBorder ? Colors.blue : Colors.white, { h: "left" });
      scoreLabel.position = { x: -visibleSize.width / 2 + 80, y: visibleSize.height / 2 - 60 };
      scoreLabel.zPosition = 100;
      this.gameCamera.addChild(scoreLabel);
      this.scoreLabel = scoreLabel;
      if (this.showGzhelBorder || this.bonusStage) {
        // The white Gzhel (or bright Gorodets) border hides the score: dark blue text on a white plate
        scoreLabel.fontColor = rgb(0.0, 0.2, 0.6);
        const plate = new ShapeNode();
        plate.fillColor = white(1, 0.9);
        plate.strokeColor = rgb(0.0, 0.3, 0.7);
        plate.lineWidth = 2;
        plate.zPosition = 99;
        this.gameCamera.addChild(plate);
        this.scorePlate = plate;
        this.updateScorePlate();
      }
    }

    this.setupFreezeLabels();
    this.sidebar.update(this.enemySpawner.remainingEnemies, this.playerTank.lives, this.player2Tank?.lives ?? 0, this.level);
    this.updateHud(true);
  }

  private updateScorePlate(): void {
    if (!this.scorePlate || !this.scoreLabel) return;
    const f = this.scoreLabel.frame;
    this.scorePlate.path = new Path().roundRect(f.x - 10, f.y - 5, f.width + 20, f.height + 10, 6);
  }

  // MARK: - Game Loop

  update(_currentTime: number): void {
    for (const controller of [this.touchController, this.touchController2]) {
      if (controller?.pausePressed) {
        controller.resetPausePressed();
        if (!this.isGameOver) this.togglePause();
      }
    }

    if (this.isGameOver || this.isGamePaused) return;

    if (this.freezeTimer > 0) {
      this.freezeTimer -= 1;
      if (this.freezeTimer === 0) {
        for (const enemy of this.enemyTanks) enemy.childNode("freezeEffect")?.removeFromParent();
      }
    }

    for (const player of this.playerTanks) {
      const index = player.playerNumber - 1;
      if (this.playerFreezeTimers[index] > 0) {
        this.playerFreezeTimers[index] -= 1;
        if (this.playerFreezeTimers[index] === 0) player.childNode("freezeEffect")?.removeFromParent();
      }
    }

    if (this.victoryDelayTimer > 0) {
      this.victoryDelayTimer -= 1;
      if (this.victoryDelayTimer === 0) {
        this.levelComplete();
        return;
      }
      // Every bonus item taken: no need to wait the full time
      if (this.levelBonusesSpawned && this.victoryDelayTimer > 90 && !this.powerUps.some((p) => p.isPlayersOnly)) {
        this.victoryDelayTimer = 90;
      }
    }

    this.updateBaseProtection();
    for (const player of this.playerTanks) this.updatePlayer(player);
    this.updateEnemies();
    this.updateBossHealthBar();
    this.updateGzhelSpawn();
    this.updateGzhelTank();
    this.updateBullets();
    this.flushBulletRemovals(); // Bullets that hit walls must not also hit tanks this frame
    this.updatePowerUps();
    this.updateSpawner();
    this.updateUFO();
    this.updateEasterEgg();
    this.updateGoldSpawn();
    this.updateCheeseSpawn();
    this.checkAllCollisions();
    this.checkPowerUpCollisions();
    this.checkEasterEggCollisions();
    this.flushBulletRemovals();
    this.checkGameState();
    this.updateUI();
  }

  /** Movement and fire input for a player: its touch controller and/or keyboard keys */
  private input(player: Tank): { direction: Direction | null; firing: boolean } {
    const index = player.playerNumber - 1;
    const controller = player.playerNumber === 2 ? this.touchController2 : this.touchController;
    const direction = controller?.currentDirection ?? this.keyboardDirection[index];
    const firing = (controller?.isFiring ?? false) || this.keyboardFiring[index];
    return { direction, firing };
  }

  private teammate(player: Tank): Tank | null {
    if (!this.isTwoPlayer) return null;
    return player.playerNumber === 1 ? this.player2Tank : this.playerTank;
  }

  /** Two players: a player who is out of lives can take one from a teammate who has a spare */
  private canStealLife(player: Tank): boolean {
    const mate = this.teammate(player);
    if (!mate) return false;
    return player.lives <= 0 && !player.isAlive && !player.isWaitingToRespawn && mate.lives >= 2;
  }

  private stealLife(player: Tank): void {
    const mate = this.teammate(player);
    if (!mate || !this.canStealLife(player)) return;
    mate.lives -= 1;
    player.lives = 1;
    this.showEffect(`${player.playerNumber}P TOOK A LIFE!`, Tank.colorForPlayer(player.playerNumber));
    SoundManager.playPowerUp();
  }

  private updatePlayer(player: Tank): void {
    const index = player.playerNumber - 1;
    const { direction, firing } = this.input(player);
    const firePressed = firing && !this.firingLastFrame[index];
    this.firingLastFrame[index] = firing;

    if (!player.isAlive) {
      if (player.lives <= 0 && firePressed) this.stealLife(player);
      if (player.lives > 0) {
        if (!player.isWaitingToRespawn) player.respawn(spawnPosition(player.playerNumber));
        // Hold the last respawn tick while another tank sits on the spawn point
        if (player.respawnTimer === 1 && this.isPlayerSpawnBlocked(player)) return;
        player.updateRespawnTimer();
      }
      return;
    }

    if (this.playerFreezeTimers[index] <= 0) {
      if (direction !== null) player.move(direction, this.gameMap, this.allTanks);
      else player.continueIceSlide(this.gameMap, this.allTanks);
    } else if ((GameState.isEasyMode || GameState.isGzhelActive) && direction !== null) {
      player.turn(direction); // Can turn while frozen (but not move)
    }

    if (player.canDestroyTrees) this.checkForestDestruction(player);

    if (firing) {
      const newBullets = player.shoot();
      if (newBullets.length) {
        if (player.hasLaser) SoundManager.playLaser();
        else SoundManager.playShoot();
        this.addBulletsWithSpawnCheck(newBullets);
      }
    }

    player.update();
  }

  private updateEnemies(): void {
    for (const enemy of this.enemyTanks) {
      if (!enemy.isAlive) continue;
      if (this.freezeTimer > 0 && !enemy.isFreezeImmune) continue;

      if (enemy.ai) {
        const decision = enemy.ai.update(this.gameMap, this.playerTanks, this.allTanks);
        const direction = decision.direction;
        if (direction !== null) enemy.move(direction, this.gameMap, this.allTanks);
        if (enemy.canDestroyTrees) this.checkForestDestruction(enemy);
        // Cheats: enemies shoot less or more often
        let shouldShoot = decision.shouldShoot;
        const fireRate = enemy.cheatFireRate;
        if (fireRate < 1) shouldShoot = shouldShoot && Math.random() < fireRate;
        else if (fireRate > 1 && !shouldShoot) shouldShoot = Math.random() < 0.03 * (fireRate - 1);
        if (shouldShoot) {
          const newBullets = enemy.shoot();
          if (newBullets.length) {
            if (enemy.firesAlienLaser) SoundManager.playLaser();
            else SoundManager.playShoot();
            this.addBulletsWithSpawnCheck(newBullets);
          }
        }
      }
      enemy.update();
    }
  }

  private isPlayerSpawnBlocked(player: Tank): boolean {
    const spawn = spawnPosition(player.playerNumber);
    return this.allTanks.some((t) => t !== player && t.isAlive && boxesOverlap(spawn, player.size.width, t.position, t.size.width));
  }

  // MARK: - Gzhel friend

  /** Bring in the next friend whose moment has come (Gzhel friend, returning friend, crazy mode friends) */
  private updateGzhelSpawn(): void {
    if (!this.pendingFriends.length || this.victoryDelayTimer !== 0) return;
    this.gzhelFrameCounter += 1;
    const index = this.pendingFriends.findIndex((f) => this.gzhelFrameCounter >= f.frame);
    if (index < 0) return;
    const pending = this.pendingFriends[index];

    const size = C.tankSize;
    for (let attempt = 0; attempt < 20; attempt++) {
      const pos = this.findRandomEmptyPosition();
      if (this.gameMap.checkTankCollision(pos, size)) continue;
      if (!this.playerTanks.every((p) => distance(pos, p.position) > 120)) continue;
      if (this.allTanks.some((t) => t.isAlive && boxesOverlap(pos, size, t.position, t.size.width))) continue;

      const tank = new Tank(pos, Direction.Up, false, 0, EnemyType.Gzhel);
      const carry = pending.carry;
      if (carry) {
        // Same friend as last level: keeps its hits and upgrades; a Gzhel level heals it to at least 3 hits
        const hits = this.showGzhelBorder ? Math.max(carry.health, C.friendHits) : carry.health;
        tank.health = hits;
        tank.maxHealth = Math.max(carry.maxHealth, hits);
        tank.starCount = carry.starCount;
        tank.machinegunCount = carry.machinegunCount;
        tank.bulletPower = carry.bulletPower;
        tank.speedMultiplier = carry.speedMultiplier;
        tank.canSwim = carry.canSwim;
        tank.canDestroyTrees = carry.canDestroyTrees;
        tank.drawTank();
      } else if (pending.hits !== null) {
        tank.health = pending.hits;
        tank.maxHealth = pending.hits;
      }
      this.friends.push(tank);
      this.pendingFriends.splice(index, 1);
      this.invalidateAllTanksCache();
      this.gameLayer.addChild(tank);
      this.showSpawnEffect(pos);
      this.showUFOMessage(carry ? "FRIEND IS BACK!" : "FRIEND!", FRIEND_BLUE);
      return;
    }
  }

  private updateGzhelTank(): void {
    for (const gzhel of this.friends) {
      if (!gzhel.isAlive || !gzhel.ai) continue;

      let decision;
      if (this.victoryDelayTimer > 0) {
        const takeable = this.powerUps.filter((p) => p.type !== PowerUpType.Laser && !p.isPlayersOnly).map((p) => p.position);
        decision = gzhel.ai.updateFriendLevelCleared(this.gameMap, takeable);
      } else {
        const enemyBullets = this.bullets.filter((b) => b.isFromEnemy && !this.isBulletRemoved(b));
        decision = gzhel.ai.updateFriend(this.gameMap, this.enemyTanks, this.allTanks, enemyBullets);
      }
      if (decision.direction !== null) gzhel.move(decision.direction, this.gameMap, this.allTanks);
      this.updateFriendLivesLabel(gzhel);
      if (decision.shouldShoot) {
        const newBullets = gzhel.shoot();
        if (newBullets.length) {
          SoundManager.playShoot();
          this.addBulletsWithSpawnCheck(newBullets);
        }
      }
      gzhel.update();
    }
  }

  /** A friend leaves with a colorful farewell */
  dismissGzhelTank(gzhel: Tank, killed = false): void {
    if (!this.friends.includes(gzhel)) return;
    this.friends = this.friends.filter((f) => f !== gzhel);
    this.friendLivesLabels.get(gzhel)?.removeFromParent();
    this.friendLivesLabels.delete(gzhel);
    if (killed) this.showUFOMessage("FRIEND LOST!", FRIEND_BLUE);
    gzhel.health = 0;
    gzhel.ai = null;
    this.invalidateAllTanksCache();

    const rainbow = [Colors.red, Colors.orange, Colors.yellow, Colors.green, Colors.cyan, Colors.blue, Colors.magenta];
    const tint = Action.sequence(rainbow.map((c) => Action.colorize(c, 0.85, 0.12)));
    gzhel.childNode("tankBody")?.run(Action.repeat(tint, 2));

    const spinAndPop = Action.group([
      Action.rotateBy(Math.PI * 4, 1.7),
      Action.sequence([Action.scaleTo(1.5, 0.85), Action.scaleTo(0.1, 0.85)]),
    ]);
    const burst = Action.run(() => this.showConfettiBurst(gzhel.position));
    gzhel.run(Action.sequence([spinAndPop, burst, Action.removeFromParent()]));
  }

  /** Hearts floating above a friend: one per remaining hit */
  private updateFriendLivesLabel(friend: Tank): void {
    if (!friend.isAlive) return;
    let lbl = this.friendLivesLabels.get(friend);
    if (!lbl) {
      lbl = label("", 10, rgb(0.35, 0.6, 1.0), { v: "bottom" });
      lbl.zPosition = 55;
      this.gameLayer.addChild(lbl);
      this.friendLivesLabels.set(friend, lbl);
    }
    const hits = Math.max(0, friend.health);
    lbl.text = hits <= 5 ? "♥".repeat(hits) : `♥x${hits}`;
    lbl.position = { x: friend.position.x, y: friend.position.y + friend.size.height / 2 + 2 };
  }

  flashFriendHit(friend: Tank): void {
    friend.run(
      Action.sequence([Action.fadeAlpha(0.3, 0.08), Action.fadeAlpha(1.0, 0.08), Action.fadeAlpha(0.3, 0.08), Action.fadeAlpha(1.0, 0.08)]),
    );
    this.updateFriendLivesLabel(friend);
  }

  /** Friend pickups: tank upgrades go to the friend, battlefield effects work for the player's side. No score. */
  private handleFriendPowerUpCollection(powerUp: PowerUp, friend: Tank): void {
    switch (powerUp.type) {
      case PowerUpType.Tank:
        friend.health += 1;
        friend.maxHealth += 1;
        this.showEffect("FRIEND +1 HIT!", FRIEND_BLUE);
        break;
      case PowerUpType.Freeze:
        this.freezeTimer = C.freezeDuration;
        this.addFreezeEffectToEnemies();
        this.showEffect("FREEZE!", Colors.cyan);
        break;
      case PowerUpType.Bomb:
        this.destroyAllEnemies();
        this.showEffect("BOMB!", Colors.red);
        break;
      case PowerUpType.Shovel:
        this.activateBaseProtection();
        this.showEffect("STEEL BASE!", Colors.white);
        break;
      case PowerUpType.Gold:
      case PowerUpType.Laser:
        break;
      default:
        powerUp.applyTo(friend);
        friend.drawTank();
    }
    this.updateFriendLivesLabel(friend);
  }

  // MARK: - Boss

  private updateBossHealthBar(): void {
    const boss = this.enemyTanks.find((e) => e.isAlive && e.enemyType === EnemyType.Boss);
    if (!boss) {
      this.bossHealthBar?.removeFromParent();
      this.bossHealthBar = null;
      return;
    }
    const width = 34;
    const height = 5;
    let bar = this.bossHealthBar;
    if (!bar) {
      bar = new Node();
      bar.zPosition = 55;
      bar.addChild(new SpriteNode(null, white(0.1, 0.85), { width: width + 2, height: height + 2 }));
      const fillBar = new SpriteNode(null, Colors.red, { width, height });
      fillBar.anchorPoint = { x: 0, y: 0.5 };
      fillBar.position = { x: -width / 2, y: 0 };
      fillBar.name = "fill";
      bar.addChild(fillBar);
      this.gameLayer.addChild(bar);
      this.bossHealthBar = bar;
    }
    const fraction = Math.max(boss.health, 0) / Math.max(boss.maxHealth, 1);
    const fillBar = bar.childNode("fill") as SpriteNode | null;
    if (fillBar) {
      fillBar.size = { width: width * fraction, height };
      fillBar.color = fraction > 0.5 ? Colors.red : fraction > 0.2 ? Colors.orange : Colors.yellow;
    }
    bar.position = { x: boss.position.x, y: boss.position.y + boss.size.height / 2 + 6 };
  }

  flashBossHit(boss: Tank): void {
    boss.childNode("tankBody")?.run(Action.sequence([Action.colorize(Colors.white, 0.8, 0.05), Action.colorize(null, 0, 0.1)]), "flash");
  }

  /** Boss destroyed: chain of explosions, fireworks, a big title and the winning fanfare */
  showBossDefeated(position: Point): void {
    SoundManager.playBossDefeated();

    // The question mark: dropped on open ground if the boss died on water or steel
    const tile = this.gameMap.getTile(position);
    const dropPoint = tile === Tile.Water || tile === Tile.Steel ? this.findRandomEmptyPosition() : position;
    const drop = new PowerUp(dropPoint, undefined, true);
    drop.zPosition = 16; // Above the forest
    this.powerUps.push(drop);
    this.gameLayer.addChild(drop);

    for (const player of this.playerTanks) {
      player.bossFireBoost += 1;
      player.drawTank();
    }
    this.continues += 1;
    this.bossHealthBar?.removeFromParent();
    this.bossHealthBar = null;

    const cs = this.cs;
    const flash = new SpriteNode(null, Colors.white, { width: this.size.width * cs * 2, height: this.size.height * cs * 2 });
    flash.zPosition = 140;
    flash.alpha = 0.7;
    this.gameCamera.addChild(flash);
    flash.run(Action.sequence([Action.fadeOut(0.4), Action.removeFromParent()]));

    // Chain of explosions around the wreck
    const blasts = new Node();
    blasts.zPosition = 60;
    this.gameLayer.addChild(blasts);
    const chain: Action[] = [];
    for (let i = 0; i < 8; i++) {
      chain.push(
        Action.run(() => {
          const offset = i === 0 ? { x: 0, y: 0 } : { x: randomIn(-30, 30), y: randomIn(-30, 30) };
          this.addBossBlast(blasts, { x: position.x + offset.x, y: position.y + offset.y }, i === 0);
        }),
      );
      chain.push(Action.wait(0.1));
    }
    chain.push(Action.wait(1.0), Action.removeFromParent());
    blasts.run(Action.sequence(chain));

    // Fireworks all over the map
    const fireworks = new Node();
    fireworks.zPosition = 61;
    this.gameLayer.addChild(fireworks);
    const shots: Action[] = [Action.wait(0.6)];
    for (let i = 0; i < 7; i++) {
      shots.push(
        Action.run(() => this.addFireworkBurst(fireworks, { x: randomIn(120, C.gameWidth - 120), y: randomIn(160, C.gameHeight - 120) })),
      );
      shots.push(Action.wait(0.35));
    }
    shots.push(Action.wait(1.5), Action.removeFromParent());
    fireworks.run(Action.sequence(shots));

    // Big title: pops in, cycles colors, then fades
    const titleText = "☠ BOSS DEFEATED! ☠";
    const title = label(titleText, 46 * cs, Colors.yellow, { v: "center" });
    title.position = { x: 0, y: 140 * cs };
    title.zPosition = 160;
    title.setScale(0.1);
    this.gameCamera.addChild(title);

    const shadow = label(titleText, 46 * cs, white(0, 0.7), { v: "center" });
    shadow.position = { x: 3 * cs, y: -3 * cs };
    shadow.zPosition = -1;
    title.addChild(shadow);

    const pop = Action.sequence([Action.scaleTo(1.3, 0.25), Action.scaleTo(1.0, 0.15)]);
    const colors = [Colors.yellow, Colors.orange, Colors.red, Colors.magenta, Colors.cyan, Colors.green];
    const cycle = Action.repeat(
      Action.sequence(colors.map((c) => Action.sequence([Action.run(() => (title.fontColor = c)), Action.wait(0.12)]))),
      5,
    );
    const wobble = Action.repeat(Action.sequence([Action.rotateTo(0.05, 0.15), Action.rotateTo(-0.05, 0.15)]), 6);
    const extraBullet = this.playerTank.bossFireBoost % C.bossesPerExtraBullet === 0;
    const reward = label(
      extraBullet ? "🔥 FASTER SHOOTING + 1 BULLET + 1 CONTINUE! 🔥" : "🔥 FASTER SHOOTING + 1 CONTINUE! 🔥",
      20 * cs,
      Colors.white,
      { v: "center" },
    );
    reward.position = { x: 0, y: -44 * cs };
    title.addChild(reward);

    title.run(
      Action.sequence([
        pop,
        Action.group([cycle, wobble]),
        Action.rotateTo(0, 0.1),
        Action.group([Action.fadeOut(0.6), Action.scaleTo(1.6, 0.6)]),
        Action.removeFromParent(),
      ]),
    );
  }

  private addBossBlast(parent: Node, point: Point, big: boolean): void {
    SoundManager.playExplosion();
    const radius = big ? 22 : 12;
    const balls: [Color, number, number][] = [
      [Colors.yellow, 3.5, 0.0],
      [Colors.orange, 2.8, 0.05],
      [Colors.red, 2.0, 0.1],
    ];
    for (const [color, scale, delay] of balls) {
      const ball = ShapeNode.circle(radius);
      ball.fillColor = color;
      ball.strokeColor = Colors.clear;
      ball.position = { ...point };
      ball.setScale(0.2);
      parent.addChild(ball);
      ball.run(
        Action.sequence([
          Action.wait(delay),
          Action.group([Action.scaleTo(scale * (big ? 1.4 : 1), 0.35), Action.fadeOut(0.45)]),
          Action.removeFromParent(),
        ]),
      );
    }
    if (big) {
      const ring = ShapeNode.circle(16);
      ring.strokeColor = Colors.white;
      ring.lineWidth = 4;
      ring.position = { ...point };
      parent.addChild(ring);
      ring.run(Action.sequence([Action.group([Action.scaleTo(9, 0.7), Action.fadeOut(0.7)]), Action.removeFromParent()]));
    }
  }

  private addFireworkBurst(parent: Node, point: Point): void {
    const color = hsb(Math.random(), 0.9, 1);
    const count = 22;
    for (let i = 0; i < count; i++) {
      const spark = new SpriteNode(null, i % 4 === 0 ? Colors.white : color, { width: 4, height: 4 });
      spark.position = { ...point };
      parent.addChild(spark);
      const angle = (i / count) * Math.PI * 2;
      const dist = randomIn(50, 80);
      const fly = Action.moveBy(Math.cos(angle) * dist, Math.sin(angle) * dist, 0.7).ease("easeOut");
      spark.run(
        Action.sequence([
          Action.group([fly, Action.sequence([Action.wait(0.4), Action.fadeOut(0.8)])]),
          Action.moveBy(0, -18, 0.5),
          Action.removeFromParent(),
        ]),
      );
    }
  }

  /** Colorful confetti and a blue ring (friend farewell) */
  private showConfettiBurst(position: Point): void {
    const colors = [Colors.red, Colors.orange, Colors.yellow, Colors.green, Colors.cyan, Colors.blue, Colors.magenta, Colors.white];
    for (let i = 0; i < 36; i++) {
      const piece = new SpriteNode(null, colors[i % colors.length], { width: 5, height: 5 });
      piece.position = { ...position };
      piece.zPosition = 60;
      piece.zRotation = randomIn(0, Math.PI);
      this.gameLayer.addChild(piece);
      const angle = (i / 36) * Math.PI * 2 + randomIn(-0.1, 0.1);
      const dist = randomIn(40, 90);
      const fly = Action.moveBy(Math.cos(angle) * dist, Math.sin(angle) * dist, 0.9).ease("easeOut");
      piece.run(Action.sequence([Action.group([fly, Action.rotateBy(Math.PI * 3, 0.9), Action.fadeOut(0.9)]), Action.removeFromParent()]));
    }
    const ring = ShapeNode.circle(10);
    ring.strokeColor = rgb(0.2, 0.45, 1.0);
    ring.lineWidth = 3;
    ring.position = { ...position };
    ring.zPosition = 59;
    this.gameLayer.addChild(ring);
    ring.run(Action.sequence([Action.group([Action.scaleTo(6, 0.6), Action.fadeOut(0.6)]), Action.removeFromParent()]));
  }

  // MARK: - Bullets

  /** SAW: clear forest under the tank */
  private checkForestDestruction(tank: Tank): void {
    const half = tank.size.width / 2;
    const p = tank.position;
    for (const pos of [p, { x: p.x - half, y: p.y }, { x: p.x + half, y: p.y }, { x: p.x, y: p.y - half }, { x: p.x, y: p.y + half }]) {
      this.gameMap.destroyForest(pos);
    }
  }

  private updateBullets(): void {
    const outOfBounds: Bullet[] = [];
    const hitObstacle: Bullet[] = [];
    for (const bullet of this.bullets) {
      bullet.update();
      if (bullet.isOutOfBounds(this.gameMap.pixelSize)) {
        outOfBounds.push(bullet);
        continue;
      }
      if (bullet.isLaser) continue; // Laser light passes through walls
      if (this.gameMap.checkBulletCollision(bullet.position, bullet.power).hit) hitObstacle.push(bullet);
    }
    for (const b of outOfBounds) this.removeBullet(b, false);
    for (const b of hitObstacle) this.removeBullet(b, true);
  }

  /** A bullet spawned inside a wall hits it at once (and is never added) */
  private addBulletsWithSpawnCheck(newBullets: Bullet[]): void {
    for (const bullet of newBullets) {
      if (!bullet.isLaser && this.gameMap.checkBulletCollision(bullet.position, bullet.power).hit) {
        bullet.owner?.bulletDestroyed(bullet, true);
        continue;
      }
      this.bullets.push(bullet);
      this.gameLayer.addChild(bullet);
    }
  }

  removeBullet(bullet: Bullet, hitObstacle = false): void {
    // Idempotent: the owner's active-bullet count drops exactly once
    if (this.bulletsMarkedForRemoval.has(bullet)) return;
    this.bulletsMarkedForRemoval.add(bullet);
    bullet.owner?.bulletDestroyed(bullet, hitObstacle);
    bullet.removeFromParent();
  }

  isBulletRemoved(bullet: Bullet): boolean {
    return this.bulletsMarkedForRemoval.has(bullet);
  }

  private flushBulletRemovals(): void {
    if (!this.bulletsMarkedForRemoval.size) return;
    this.bullets = this.bullets.filter((b) => !this.bulletsMarkedForRemoval.has(b));
    this.bulletsMarkedForRemoval.clear();
  }

  // MARK: - Power-ups, spawner, UFO, egg, gold

  private updatePowerUps(): void {
    const expired = this.powerUps.filter((p) => p.update());
    for (const p of expired) p.removeFromParent();
    if (expired.length) this.powerUps = this.powerUps.filter((p) => !expired.includes(p));
  }

  private updateSpawner(): void {
    const nonEnemyTanks = [...this.friends, ...(this.player2Tank ? [this.player2Tank] : [])];
    const newEnemy = this.enemySpawner.update(this.enemyTanks, this.playerTank, this.gameMap, nonEnemyTanks);
    if (newEnemy) {
      this.enemyTanks.push(newEnemy);
      this.invalidateAllTanksCache();
      this.applyBossSpeedUp(newEnemy);
      this.gameLayer.addChild(newEnemy);
      this.showSpawnEffect(newEnemy.position);
      if (newEnemy.enemyType === EnemyType.Boss) {
        // Every next boss is one hit tougher: level 10 → 10 HP, level 20 → 11...
        const bossNumber = Math.max(Math.floor(this.level / C.bossLevelInterval), 1);
        newEnemy.health = C.bossBaseHealth + bossNumber - 1;
        newEnemy.maxHealth = newEnemy.health;
        this.showEffect("☠ BOSS IS COMING! ☠", Colors.red);
      }
      this.applyEnemyCheats(newEnemy);
    }
    const extra = this.enemySpawner.spawnExtraEnemy(this.enemyTanks, this.playerTank, this.gameMap, nonEnemyTanks);
    if (extra) {
      this.enemyTanks.push(extra);
      this.invalidateAllTanksCache();
      this.applyBossSpeedUp(extra);
      this.applyEnemyCheats(extra);
      this.gameLayer.addChild(extra);
      this.showSpawnEffect(extra.position);
    }
  }

  private applyBossSpeedUp(enemy: Tank): void {
    const speedUp = this.enemySpeedFactor;
    enemy.baseSpeedMultiplier = speedUp;
    enemy.speedMultiplier = speedUp;
  }

  /** Lightning flash where a tank appears */
  private showSpawnEffect(position: Point): void {
    const effect = new Node();
    effect.position = { ...position };
    effect.zPosition = 50;
    const bolt = getLightningBoltTexture();
    for (let i = 0; i < 6; i++) {
      const sprite = new SpriteNode(bolt, Colors.white, { width: 20, height: 35 });
      sprite.zRotation = (i * Math.PI) / 3;
      effect.addChild(sprite);
    }
    effect.addChild(new SpriteNode(getSpawnFlashTexture(), Colors.white, { width: 40, height: 40 }));
    this.gameLayer.addChild(effect);
    effect.run(Action.sequence([Action.scaleTo(1.3, 0.1), Action.fadeOut(0.2), Action.removeFromParent()]));
  }

  private updateUFO(): void {
    if (this.ufoMessageTimer > 0) {
      this.ufoMessageTimer -= 1;
      if (this.ufoMessageTimer === 0) {
        this.ufoMessageLabel?.removeFromParent();
        this.ufoMessageLabel = null;
      }
    }

    const cheats = CheatSettings.active;
    if (!cheats.ufoEnabled) {
      // Cheats: UFO switched off
    } else if (cheats.crazyMode) {
      // Crazy mode: several UFOs a level, no conditions (up to 3 at once)
      if (this.crazyUFOsLeft > 0 && this.ufos.length < 3 && this.victoryDelayTimer === 0 && Math.random() < 0.002) {
        this.crazyUFOsLeft -= 1;
        this.spawnUFO();
      }
    } else if (!this.ufoSpawnedThisLevel && !this.ufos.length && !this.alienMode && !GameState.isEasyMode) {
      if (this.playerTanks.some((p) => p.machinegunCount > 0) && this.playerKills >= C.ufoKillsRequired && Math.random() < C.ufoSpawnChance) {
        this.spawnUFO();
      }
    }

    // A shot down UFO is removed right away, so one that is gone escaped
    for (const ufo of [...this.ufos]) {
      if (!ufo.isAlive) {
        this.showUFOMessage("UFO ESCAPED!", Colors.red);
        this.ufoEscapedThisLevel = true;
        ufo.removeFromParent();
        this.ufos = this.ufos.filter((u) => u !== ufo);
        continue;
      }
      for (const bullet of ufo.update()) {
        this.bullets.push(bullet);
        this.gameLayer.addChild(bullet);
        SoundManager.playLaser();
      }
    }
  }

  private spawnUFO(): void {
    const ufo = new UFO(this.gameMap.pixelSize);
    this.ufos.push(ufo);
    this.gameLayer.addChild(ufo);
    this.ufoSpawnedThisLevel = true;
    this.showUFOMessage("UFO INCOMING!", Colors.yellow);
  }

  showUFOMessage(text: string, color: Color): void {
    this.ufoMessageLabel?.removeFromParent();
    const cs = this.cs;
    const lbl = label(text, 28 * cs, color);
    lbl.position = { x: 0, y: 80 * cs };
    lbl.zPosition = 150;
    this.gameCamera.addChild(lbl);
    this.ufoMessageLabel = lbl;
    this.ufoMessageTimer = C.ufoMessageDuration;
  }

  private updateEasterEgg(): void {
    const egg = this.easterEgg;
    if (!egg) return;
    egg.update();
    if (egg.isExpired) {
      egg.removeFromParent();
      this.easterEgg = null;
    }
  }

  /** Gold: Gzhel levels only, once per level */
  private updateGoldSpawn(): void {
    if (!this.showGzhelBorder || this.goldSpawnedThisLevel || this.victoryDelayTimer !== 0) return;
    this.goldSpawnTimer += 1;
    if (this.goldSpawnTimer <= 300) return;
    if (Math.random() < this.goldSpawnChance) this.spawnGold();
  }

  /** Boss bonus stage: the cheese appears once at its random moment
   *  (or as soon as only a few enemies are left, so it never gets skipped) */
  private updateCheeseSpawn(): void {
    if (this.cheeseSpawnFrame === null || this.victoryDelayTimer !== 0) return;
    this.cheeseFrameCounter += 1;
    const enemiesLeft = this.enemySpawner.remainingEnemies + this.enemyTanks.filter((e) => e.isAlive).length;
    if (this.cheeseFrameCounter < this.cheeseSpawnFrame && !(this.cheeseFrameCounter > 300 && enemiesLeft <= 3)) return;
    this.cheeseSpawnFrame = null;
    const cheese = new PowerUp(this.findRandomEmptyPosition(), PowerUpType.Cheese);
    this.powerUps.push(cheese);
    this.gameLayer.addChild(cheese);
    this.showEffect("🧀 CHEESE!", Colors.yellow);
    SoundManager.playPowerUpSpawn();
  }

  private spawnGold(): void {
    this.goldSpawnedThisLevel = true;
    const gold = new PowerUp(this.findRandomEmptyPosition(), PowerUpType.Gold);
    this.powerUps.push(gold);
    this.gameLayer.addChild(gold);
    this.showEffect("GOLD!", Colors.yellow);
    SoundManager.playPowerUpSpawn();
  }

  // MARK: - Collisions

  private checkAllCollisions(): void {
    this.checkBulletTankCollisions();
    this.checkBulletBulletCollisions();
    this.checkBulletBaseCollision();
    this.checkBulletUFOCollisions();
  }

  private checkBulletTankCollisions(): void {
    const bulletsToRemove: Bullet[] = [];
    const enemiesToRemove: Tank[] = [];

    for (const bullet of this.bullets) {
      if (this.isBulletRemoved(bullet)) continue;

      // The friend stops everyone else's bullets; only enemy bullets hurt it
      const friend = bullet.isFromGzhel ? undefined : this.friends.find((f) => f.isAlive && bullet.collidesWithTank(f));
      if (friend) {
        bulletsToRemove.push(bullet);
        if (bullet.isFromEnemy) {
          friend.damage();
          if (friend.isAlive) {
            this.flashFriendHit(friend);
          } else {
            SoundManager.playExplosion();
            this.dismissGzhelTank(friend, true);
          }
        }
        continue;
      }

      // Friend bullets destroy enemies (no score) and can't hurt players
      if (bullet.isFromGzhel) {
        if (this.playerTanks.some((p) => p.isAlive && bullet.collidesWithTank(p))) {
          bulletsToRemove.push(bullet);
          continue;
        }
        for (const enemy of this.enemyTanks) {
          if (!enemy.isAlive || !bullet.collidesWithTank(enemy)) continue;
          enemy.damage();
          bulletsToRemove.push(bullet);
          if (!enemy.isAlive) {
            enemiesToRemove.push(enemy);
            SoundManager.playExplosion();
            if (enemy.enemyType === EnemyType.Boss) this.showBossDefeated(enemy.position);
          } else if (enemy.enemyType === EnemyType.Boss) {
            this.flashBossHit(enemy);
          }
          break;
        }
        continue;
      }

      if (!bullet.isFromEnemy) {
        // Two players: a teammate stops the other player's bullet harmlessly (lasers pass through)
        if (!bullet.isLaser && this.playerTanks.some((p) => p !== bullet.owner && p.isAlive && bullet.collidesWithTank(p))) {
          bulletsToRemove.push(bullet);
          continue;
        }
        for (const enemy of this.enemyTanks) {
          if (!enemy.isAlive || !bullet.collidesWithTank(enemy)) continue;
          const wasPowerTank = enemy.enemyType === EnemyType.Power;
          if (bullet.isLaser && enemy.enemyType !== EnemyType.Boss) enemy.destroyInstantly();
          else enemy.damage();
          if (enemy.isAlive && enemy.enemyType === EnemyType.Boss) this.flashBossHit(enemy);
          bulletsToRemove.push(bullet);

          // Power tanks drop a power-up every time they are shot
          if (wasPowerTank) this.spawnPowerUp();

          if (!enemy.isAlive) {
            enemiesToRemove.push(enemy);
            const killedType = enemy.scoreType;
            this.addScore(scoreForEnemyType(killedType), bullet.owner);
            this.playerKills += 1;
            this.killsByType.set(killedType, (this.killsByType.get(killedType) ?? 0) + 1);
            const shooter = this.killsByPlayer[bullet.owner?.playerNumber === 2 ? 1 : 0];
            shooter.set(killedType, (shooter.get(killedType) ?? 0) + 1);
            SoundManager.playExplosion();

            if (killedType === EnemyType.Boss) {
              this.showBossDefeated(enemy.position);
            } else if (killedType === EnemyType.Alien) {
              // The alien always drops the LASER (its only source)
              this.spawnPowerUp(PowerUpType.Laser);
              this.showEffect("ALIEN DOWN!", Colors.green);
            } else if (!wasPowerTank && randomInt(1, 5) === 1) {
              this.spawnPowerUp();
            }
          }
          break;
        }
      } else {
        const player = this.playerTanks.find((p) => p.isAlive && bullet.collidesWithTank(p));
        if (player) {
          bulletsToRemove.push(bullet);
          if (!player.hasShield) {
            player.damage();
            if (!player.isAlive) this.handlePlayerKilled(player);
          }
        }
      }
    }

    for (const b of bulletsToRemove) this.removeBullet(b);
    if (enemiesToRemove.length) {
      for (const e of enemiesToRemove) e.removeFromParent();
      this.enemyTanks = this.enemyTanks.filter((e) => !enemiesToRemove.includes(e));
      this.invalidateAllTanksCache();
    }
  }

  /** Shared cleanup when a player dies (bullet, bomb...). Respawn starts in updatePlayer(). */
  private handlePlayerKilled(player: Tank): void {
    SoundManager.playPlayerDeath();
    this.playerFreezeTimers[player.playerNumber - 1] = 0;
    player.childNode("freezeEffect")?.removeFromParent();
  }

  private checkBulletBulletCollisions(): void {
    const bullets = this.bullets;
    if (bullets.length < 2) return;
    const toRemove = new Set<Bullet>();
    for (let i = 0; i < bullets.length; i++) {
      const a = bullets[i];
      if (this.isBulletRemoved(a) || toRemove.has(a)) continue;
      for (let j = i + 1; j < bullets.length; j++) {
        const b = bullets[j];
        if (this.isBulletRemoved(b) || toRemove.has(b)) continue;
        if (a.isLaser || b.isLaser) {
          // Laser light burns through the other side's bullets and keeps going
          const laser = a.isLaser ? a : b;
          const other = a.isLaser ? b : a;
          if (!other.isLaser && other.isFromEnemy !== laser.isFromEnemy && laser.collidesWithBullet(other)) toRemove.add(other);
          continue;
        }
        if (a.collidesWithBullet(b)) {
          toRemove.add(a);
          toRemove.add(b);
          break;
        }
      }
    }
    for (const b of toRemove) this.removeBullet(b, true);
  }

  private checkBulletBaseCollision(): void {
    for (const bullet of this.bullets) {
      if (this.isBulletRemoved(bullet) || bullet.isLaser) continue;
      if (!this.base.checkCollision(bullet.position)) continue;
      // The friend can't kill the base: its stray shots stop there harmlessly.
      // Nor can anyone once the cheese made the base invincible
      if (bullet.isFromGzhel || this.baseInvincible) {
        this.removeBullet(bullet);
        continue;
      }
      this.base.destroy();
      this.removeBullet(bullet);
      SoundManager.playBaseDestroyed();
      this.gameOver();
      break;
    }
  }

  private checkBulletUFOCollisions(): void {
    for (const ufo of [...this.ufos]) {
      if (!ufo.isAlive) continue;
      for (const bullet of this.bullets) {
        if (this.isBulletRemoved(bullet) || !ufo.collidesWith(bullet)) continue;
        this.removeBullet(bullet);
        if (ufo.damage()) {
          this.ufoWasKilled = true;
          ufo.createDestroyEffect();
          ufo.removeFromParent();
          this.ufos = this.ufos.filter((u) => u !== ufo);
          // One easter egg at a time
          if (!this.easterEgg) {
            const eggPosition = this.findRandomEmptyPosition();
            this.easterEgg = new EasterEgg(eggPosition.x, eggPosition.y);
            this.gameLayer.addChild(this.easterEgg);
          }
          this.showUFOMessage("UFO DESTROYED!", Colors.green);
        }
        break;
      }
    }
  }

  private checkEasterEggCollisions(): void {
    const egg = this.easterEgg;
    if (!egg || egg.isCollected) return;

    const player = this.playerTanks.find((p) => p.isAlive && egg.collidesWith(p));
    if (player) {
      egg.collect();
      this.easterEgg = null;
      this.playerCollectedEasterEgg = true;
      player.addLives(C.easterEggLivesBonus);
      for (const enemy of this.enemyTanks) {
        if (enemy.isAlive && enemy.enemyType !== EnemyType.Boss) enemy.convertToType(EnemyType.Power);
      }
      this.showEffect("+3 LIVES!", Colors.green);
      this.showUFOMessage("EASTER EGG!", Colors.magenta);
      return;
    }

    for (const enemy of this.enemyTanks) {
      if (!enemy.isAlive || !egg.collidesWith(enemy)) continue;
      egg.collect();
      this.easterEgg = null;
      for (const other of this.enemyTanks) {
        if (other.isAlive && other.enemyType !== EnemyType.Boss) other.convertToType(EnemyType.Heavy);
      }
      this.showUFOMessage("ENEMIES POWERED UP!", Colors.red);
      return;
    }
  }

  private checkPowerUpCollisions(): void {
    const toRemove: PowerUp[] = [];
    const touches = (tank: Tank, p: PowerUp) => {
      const d = (tank.size.width + p.size.width) / 2;
      return Math.abs(tank.position.x - p.position.x) < d && Math.abs(tank.position.y - p.position.y) < d;
    };

    for (const powerUp of this.powerUps) {
      // Dead players waiting to respawn can't collect
      const collector = this.playerTanks.find((p) => p.isAlive && touches(p, powerUp));
      if (collector) {
        this.handlePowerUpCollection(powerUp, collector);
        toRemove.push(powerUp);
        SoundManager.playPowerUp();
        continue;
      }

      const takeable = powerUp.type !== PowerUpType.Laser && !powerUp.isPlayersOnly;
      const friend = takeable ? this.friends.find((f) => f.isAlive && touches(f, powerUp)) : undefined;
      if (friend) {
        this.handleFriendPowerUpCollection(powerUp, friend);
        toRemove.push(powerUp);
        SoundManager.playPowerUp();
        continue;
      }

      // Cheats can stop enemies taking power-ups at all
      if (takeable && CheatSettings.active.enemiesTakePowerUps) {
        const enemy = this.enemyTanks.find((e) => e.isAlive && touches(e, powerUp));
        if (enemy) {
          this.handleEnemyPowerUpCollection(powerUp, enemy);
          toRemove.push(powerUp);
        }
      }
    }

    for (const p of toRemove) p.removeFromParent();
    if (toRemove.length) this.powerUps = this.powerUps.filter((p) => !toRemove.includes(p));
  }

  private handleEnemyPowerUpCollection(powerUp: PowerUp, enemy: Tank): void {
    switch (powerUp.type) {
      case PowerUpType.Shield:
        this.upgradeEnemyTank(enemy);
        break;
      case PowerUpType.Star:
        enemy.starCount += 1;
        this.showEffect("ENEMY POWERED!", Colors.red);
        break;
      case PowerUpType.Tank:
        this.enemySpawner.addExtraEnemy();
        this.showEffect("EXTRA ENEMY!", Colors.red);
        break;
      case PowerUpType.Gun:
        enemy.bulletPower = 2;
        this.showEffect("ENEMY GUN!", Colors.red);
        break;
      case PowerUpType.Car:
        enemy.speedMultiplier = enemy.baseSpeedMultiplier * 1.5;
        this.showEffect("ENEMY FAST!", Colors.red);
        break;
      case PowerUpType.Ship:
        enemy.activateShip();
        this.showEffect("ENEMY SHIP!", Colors.red);
        break;
      case PowerUpType.Machinegun:
        enemy.machinegunCount += 1;
        this.showEffect("ENEMY MACHINEGUN!", Colors.red);
        break;
      case PowerUpType.Freeze: {
        // Players freeze (they can still shoot); MAGIC protects
        let frozen = false;
        for (const player of this.playerTanks) {
          if (!player.isAlive || player.hasMagic) continue;
          this.playerFreezeTimers[player.playerNumber - 1] = this.playerFreezeDuration;
          this.addFreezeEffect(player);
          frozen = true;
        }
        if (frozen) this.showEffect(this.isTwoPlayer ? "PLAYERS FROZEN!" : "PLAYER FROZEN!", Colors.red);
        else if (this.playerTanks.some((p) => p.isAlive && p.hasMagic)) this.showEffect("🔮 MAGIC STOPPED THE FREEZE!", MAGIC_COLOR);
        break;
      }
      case PowerUpType.Bomb:
        // Kills the players at once, through ship and shield, but not MAGIC
        if (this.playerTanks.some((p) => p.isAlive && p.hasMagic)) this.showEffect("🔮 MAGIC STOPPED THE BOMB!", MAGIC_COLOR);
        for (const player of this.playerTanks) {
          if (!player.isAlive || player.hasMagic) continue;
          player.damage(true, true);
          if (!player.isAlive) {
            player.deathsThisLevel -= 1; // A bomb death doesn't cost the soccer ball
            this.handlePlayerKilled(player);
          }
        }
        this.showEffect("BOMB!", Colors.red);
        break;
      case PowerUpType.Shovel:
        this.removeBaseProtection();
        this.showEffect("BASE EXPOSED!", Colors.red);
        break;
      case PowerUpType.Saw:
        enemy.canDestroyTrees = true;
        this.showEffect("ENEMY SAW!", Colors.red);
        break;
      case PowerUpType.Gold:
        this.handleEnemyGoldCollection(enemy);
        break;
      default:
        break; // Laser, level bonuses, magic and cheese: never collected by enemies
    }
  }

  private handleEnemyGoldCollection(enemy: Tank): void {
    switch (enemy.enemyType) {
      case EnemyType.Power:
        enemy.convertToType(EnemyType.Heavy);
        this.showEffect("GOLD HEAVY!", Colors.red);
        break;
      case EnemyType.Alien:
        enemy.machinegunCount = 2;
        this.showEffect("GOLD ALIEN!", Colors.red);
        break;
      case EnemyType.Boss:
        enemy.health = enemy.maxHealth;
        enemy.machinegunCount = 2;
        this.showEffect("GOLD BOSS!", Colors.red);
        break;
      case EnemyType.Heavy:
        enemy.speedMultiplier = enemy.baseSpeedMultiplier * 1.8;
        enemy.machinegunCount = 2;
        enemy.activateShip();
        this.showEffect("GOLD ULTIMATE!", Colors.red);
        break;
      default:
        enemy.convertToType(EnemyType.Power);
        this.showEffect("GOLD POWER!", Colors.red);
    }
  }

  /** Enemy took a shield: it upgrades its tank type */
  private upgradeEnemyTank(enemy: Tank): void {
    switch (enemy.enemyType) {
      case EnemyType.Regular:
        enemy.convertToType(EnemyType.Armored);
        this.showEffect("ENEMY ARMORED!", Colors.red);
        break;
      case EnemyType.Armored:
        enemy.convertToType(EnemyType.Heavy);
        this.showEffect("ENEMY HEAVY!", Colors.red);
        break;
      case EnemyType.Fast: {
        const savedSpeed = enemy.moveSpeed;
        enemy.convertToType(EnemyType.Armored);
        enemy.moveSpeed = savedSpeed;
        this.showEffect("FAST ARMORED!", Colors.red);
        break;
      }
      case EnemyType.Power:
        enemy.health = 3;
        enemy.maxHealth = 3;
        this.showEffect("POWER TANK+!", Colors.red);
        break;
      default:
        enemy.health = enemy.maxHealth;
        this.showEffect("ENEMY HEALED!", Colors.red);
    }
  }

  /** Enemy freeze on players: easy 10s, Gzhel / alien levels 15s, normal 20s */
  private get playerFreezeDuration(): number {
    if (GameState.isEasyMode) return C.playerFreezeEasy;
    if (this.showGzhelBorder || this.alienMode) return C.playerFreezeSpecial;
    return C.playerFreezeNormal;
  }

  private makeFreezeNode(tank: Tank, count: number, crystal: Size, radius: number): Node {
    const node = new Node();
    node.name = "freezeEffect";
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count;
      const c = ShapeNode.rect(crystal.width, crystal.height);
      c.fillColor = withAlpha(Colors.cyan, 0.7);
      c.strokeColor = Colors.white;
      c.lineWidth = 1;
      c.position = { x: Math.cos(angle) * tank.size.width * radius, y: Math.sin(angle) * tank.size.height * radius };
      c.zRotation = angle;
      node.addChild(c);
    }
    node.run(Action.repeatForever(Action.sequence([Action.scaleTo(1.1, 0.3), Action.scaleTo(0.9, 0.3)])));
    return node;
  }

  private addFreezeEffect(player: Tank): void {
    player.childNode("freezeEffect")?.removeFromParent();
    player.addChild(this.makeFreezeNode(player, 8, { width: 4, height: 8 }, 0.5));
  }

  private addFreezeEffectToEnemies(): void {
    for (const enemy of this.enemyTanks) {
      if (!enemy.isAlive || enemy.isFreezeImmune) continue;
      enemy.childNode("freezeEffect")?.removeFromParent();
      enemy.addChild(this.makeFreezeNode(enemy, 6, { width: 3, height: 6 }, 0.45));
    }
  }

  private handlePowerUpCollection(powerUp: PowerUp, player: Tank): void {
    if (powerUp.isMystery) {
      this.openMystery(powerUp, player);
      return;
    }
    switch (powerUp.type) {
      case PowerUpType.Gold:
        this.addScore(99, player);
        this.showEffect("+99 GOLD!", Colors.yellow);
        return;
      case PowerUpType.Strawberry:
        this.addScore(C.strawberryPoints, player);
        this.showEffect(`+${C.strawberryPoints} STRAWBERRY!`, Colors.red);
        return;
      case PowerUpType.Banana:
        this.addScore(C.bananaPoints, player);
        this.showEffect(`+${C.bananaPoints} BANANA!`, Colors.yellow);
        return;
      case PowerUpType.Ball:
        this.addScore(C.ballPoints, player);
        powerUp.applyTo(player);
        player.drawTank();
        this.showEffect(`+${C.ballPoints} GOAL! SPEED UP!`, Colors.white);
        return;
      case PowerUpType.Cheese:
        powerUp.applyTo(player); // +11 lives
        this.baseInvincible = true;
        this.base.makeInvincible();
        this.showEffect(`🧀 +${C.cheeseLivesBonus} LIVES! BASE INVINCIBLE!`, Colors.yellow);
        return;
      default:
        break;
    }

    this.addScore(1, player);

    switch (powerUp.type) {
      case PowerUpType.Freeze:
        this.freezeTimer = C.freezeDuration;
        this.addFreezeEffectToEnemies();
        this.showEffect("FREEZE!", Colors.cyan);
        break;
      case PowerUpType.Bomb:
        this.destroyAllEnemies();
        this.showEffect("BOMB!", Colors.red);
        break;
      case PowerUpType.Shovel:
        this.activateBaseProtection();
        this.showEffect("STEEL BASE!", Colors.white);
        break;
      case PowerUpType.Saw:
        player.canDestroyTrees = true;
        this.showEffect("SAW!", Colors.green);
        break;
      case PowerUpType.Laser:
        powerUp.applyTo(player);
        this.showEffect("LASER!", Colors.cyan);
        break;
      case PowerUpType.Magic:
        powerUp.applyTo(player);
        player.drawTank();
        this.showEffect("🔮 MAGIC! SAFE FROM BOMB AND FREEZE", MAGIC_COLOR);
        break;
      default:
        powerUp.applyTo(player);
    }
  }

  /** The boss's question mark: every enemy on the field dies and the player gets 3 random power-ups */
  private openMystery(powerUp: PowerUp, player: Tank): void {
    this.destroyAllEnemies(false);

    // Bomb and freeze would be wasted with no enemies left
    const prizes: PowerUpType[] = [];
    while (prizes.length < C.mysteryPrizeCount) {
      const type = PowerUp.randomType();
      if (type !== PowerUpType.Bomb && type !== PowerUpType.Freeze) prizes.push(type);
    }

    this.quietEffects = true; // One message for the whole prize
    for (const type of prizes) this.handlePowerUpCollection(new PowerUp(powerUp.position, type), player);
    this.quietEffects = false;

    const icons = prizes.map((t) => iconForType(t));
    this.showEffect(`? = ${icons.join(" ")} ENEMIES DOWN!`, rgb(0.8, 0.5, 1.0));

    icons.forEach((iconText, index) => {
      const icon = label(iconText, 26, Colors.white, { v: "center" });
      icon.position = { ...powerUp.position };
      icon.zPosition = 120;
      icon.setScale(0.3);
      this.gameLayer.addChild(icon);
      const spread = (index - Math.floor((icons.length - 1) / 2)) * 34;
      icon.run(
        Action.sequence([
          Action.wait(index * 0.12),
          Action.group([Action.scaleTo(1.6, 0.2), Action.moveBy(spread, 10, 0.2)]),
          Action.group([Action.moveBy(0, 40, 0.9), Action.fadeOut(0.9)]),
          Action.removeFromParent(),
        ]),
      );
    });
  }

  /** `countsAsBomb`: false for the boss's question mark (keeps the soccer ball) */
  private destroyAllEnemies(countsAsBomb = true): void {
    // The boss is too tough for a bomb: it takes one hit
    const survivors: Tank[] = [];
    for (const enemy of this.enemyTanks) {
      if (!enemy.isAlive || enemy.enemyType !== EnemyType.Boss) continue;
      if (countsAsBomb) this.bombUsedThisLevel = true;
      enemy.damage(true, true);
      if (enemy.isAlive) {
        this.flashBossHit(enemy);
        survivors.push(enemy);
      } else {
        this.showBossDefeated(enemy.position);
      }
    }
    for (const enemy of this.enemyTanks) {
      if (survivors.includes(enemy)) continue;
      if (enemy.isAlive) {
        if (countsAsBomb) this.bombUsedThisLevel = true;
        // No score for bomb kills
        while (enemy.isAlive) enemy.damage(true, true);
      }
      enemy.removeFromParent();
    }
    this.enemyTanks = survivors;
    this.invalidateAllTanksCache();
  }

  // MARK: - Base protection

  private activateBaseProtection(): void {
    this.baseProtectionTimer = C.baseProtectionTime;
    this.baseFlashTimer = 0;
    this.baseIsSteel = true;
    this.gameMap.setBaseProtection(true, this.allTanks);
  }

  private removeBaseProtection(): void {
    this.baseProtectionTimer = 0;
    this.baseFlashTimer = 0;
    this.baseIsSteel = false;
    this.gameMap.setBaseProtection(false);
    this.gameMap.clearBaseProtection();
  }

  private updateBaseProtection(): void {
    if (this.baseProtectionTimer <= 0) return;
    this.baseProtectionTimer -= 1;
    // Last 3 seconds: flash between steel and brick
    if (this.baseProtectionTimer <= 180 && this.baseProtectionTimer > 0) {
      this.baseFlashTimer += 1;
      if (this.baseFlashTimer >= 15) {
        this.baseFlashTimer = 0;
        this.baseIsSteel = !this.baseIsSteel;
        this.gameMap.setBaseProtection(this.baseIsSteel, this.allTanks);
      }
    }
    if (this.baseProtectionTimer === 0) {
      this.baseIsSteel = false;
      this.gameMap.setBaseProtection(false, this.allTanks);
    }
  }

  /** Level cleared: strawberry for crossing 250 points this level, banana for 500, ball for a clean level */
  private spawnLevelBonuses(): boolean {
    const bonuses: PowerUpType[] = [];
    for (let i = 0; i < this.playerCount; i++) {
      const before = this.levelStartScores[i];
      const after = this.scores[i];
      if (before < C.strawberryScoreThreshold && after >= C.strawberryScoreThreshold) bonuses.push(PowerUpType.Strawberry);
      if (before < C.bananaScoreThreshold && after >= C.bananaScoreThreshold) bonuses.push(PowerUpType.Banana);
    }
    const playerDied = this.playerTanks.some((p) => p.deathsThisLevel > 0);
    if (!this.bombUsedThisLevel && !playerDied) bonuses.push(PowerUpType.Ball);
    for (const type of bonuses) this.spawnPowerUp(type);
    this.levelBonusesSpawned = bonuses.length > 0;
    return this.levelBonusesSpawned;
  }

  /** New power-up at a random empty spot */
  spawnPowerUp(type?: PowerUpType): void {
    const powerUp = new PowerUp(this.findRandomEmptyPosition(), type ?? (this.rollMagic() ? PowerUpType.Magic : undefined));
    this.powerUps.push(powerUp);
    this.gameLayer.addChild(powerUp);
    SoundManager.playPowerUpSpawn();
  }

  /** MAGIC is very rare; the bonus stage has a better chance and always gets at least one */
  private rollMagic(): boolean {
    let roll: boolean;
    if (this.bonusStage) {
      const enemiesLeft = this.enemySpawner.remainingEnemies + this.enemyTanks.filter((e) => e.isAlive).length;
      roll = (!this.magicSpawnedThisLevel && enemiesLeft <= C.magicGuaranteeEnemiesLeft) || Math.random() < C.magicChanceBonusStage;
    } else {
      roll = Math.random() < C.magicChance;
    }
    if (roll) this.magicSpawnedThisLevel = true;
    return roll;
  }

  findRandomEmptyPosition(): Point {
    const ts = C.tileSize;
    const empty: Point[] = [];
    for (let row = 2; row < 24; row++) {
      for (let col = 2; col < 24; col++) {
        const p = { x: col * ts + ts / 2, y: (C.mapHeight - 1 - row) * ts + ts / 2 };
        if (this.gameMap.getTile(p) === Tile.Empty) empty.push(p);
      }
    }
    // Keep clear of tanks (an enemy would grab it at once) and of other power-ups
    const clearance = ts * 2;
    const tanks = this.allTanks.filter((t) => t.isAlive);
    const isClear = (p: Point) =>
      !tanks.some((t) => Math.abs(t.position.x - p.x) < clearance && Math.abs(t.position.y - p.y) < clearance) &&
      !this.powerUps.some((u) => Math.abs(u.position.x - p.x) < ts && Math.abs(u.position.y - p.y) < ts);
    const clear = randomElement(empty.filter(isClear));
    if (clear) return clear;

    // Crowded field: the empty spot farthest from any tank
    const nearest = (p: Point) => Math.min(...tanks.map((t) => distance(p, t.position)), Infinity);
    let best: Point | null = null;
    let bestDistance = -1;
    for (const p of empty) {
      const d = nearest(p);
      if (d > bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best ?? { x: 13 * ts + ts / 2, y: 13 * ts + ts / 2 };
  }

  showEffect(text: string, color: Color): void {
    if (this.quietEffects) return;
    const cs = this.cs;
    const lbl = label(text, 32 * cs, color);
    lbl.position = { x: 0, y: 50 * cs };
    lbl.zPosition = 150;
    this.gameCamera.addChild(lbl);
    lbl.run(Action.sequence([Action.wait(1.0), Action.fadeOut(0.5), Action.removeFromParent()]));
  }

  // MARK: - Game state

  private checkGameState(): void {
    if (this.enemySpawner.allEnemiesDefeated(this.enemyTanks) && this.victoryDelayTimer === 0 && !this.isGameOver) {
      this.victoryDelayTimer = C.victoryDelay;
      this.showEffect("VICTORY! Collect power-ups!", Colors.green);
      // Wait longer while there are bonuses (or the boss's question mark) to pick up
      if (this.spawnLevelBonuses() || this.powerUps.some((p) => p.isMystery)) {
        this.levelBonusesSpawned = true;
        this.victoryDelayTimer = C.levelBonusVictoryDelay;
      }
      // The friend comes along to the next level; one that hasn't appeared yet won't now
      this.pendingFriends = [];
    }
    if (this.playerTanks.every((p) => p.lives <= 0 && !p.isAlive)) this.gameOver();
  }

  private levelComplete(): void {
    this.isGameOver = true;
    this.didWinLevel = true;
    this.lockEndScreenInput();
    this.hideFreezeLabels();
    this.releaseControllerTouches();
    SoundManager.stopGameplaySounds();
    SoundManager.playVictory();
    setConsecutiveLosses(0);

    const bonus = this.awardKillBonus();
    this.showScoreBreakdown("LEVEL COMPLETE!", Colors.green, false, bonus);

    const resident = this.baseResident;
    if (resident.kind === "woman") this.base.playCarPickupAnimation(false);
    else if (resident.kind === "rat") this.base.playCarPickupAnimation(true);
    else if (resident.kind === "dog") this.base.playDogPeeAnimation();
    else if (this.alienMode) this.base.playAlienVictoryAnimation();
    else if (this.playerCollectedEasterEgg) this.base.playVictoryAnimation();
  }

  /** End screens ignore taps and Enter for a moment, so a player still firing doesn't skip them */
  private lockEndScreenInput(): void {
    this.endScreenInputUnlockTime = now() + 1.0;
  }
  private get isEndScreenInputLocked(): boolean {
    return now() < this.endScreenInputUnlockTime;
  }

  private togglePause(): void {
    this.isGamePaused = !this.isGamePaused;
    // Freeze actions in the game world too; the overlay lives on the camera and keeps running
    this.gameLayer.isPaused = this.isGamePaused;

    if (this.isGamePaused) {
      this.releaseControllerTouches();
      const cs = this.cs;
      const overlay = new Node();
      overlay.zPosition = 200;
      const background = new SpriteNode(null, white(0, 0.7), { width: this.size.width * cs * 1.5, height: this.size.height * cs * 1.5 });
      overlay.addChild(background);

      const pauseLabel = label("PAUSED", 48 * cs, Colors.white);
      pauseLabel.position = { x: 0, y: 80 * cs };
      overlay.addChild(pauseLabel);

      this.addButton(overlay, "resumeButton", "RESUME", { x: 0, y: 20 * cs });
      this.addButton(overlay, "muteButton", this.muteButtonTitle, { x: 0, y: -40 * cs });
      this.addButton(overlay, "menuButton", "MENU", { x: 0, y: -100 * cs });

      this.gameCamera.addChild(overlay);
      this.pauseOverlay = overlay;
    } else {
      this.pauseOverlay?.removeFromParent();
      this.pauseOverlay = null;
      for (const name of ["resumeButton", "muteButton", "menuButton"]) this.buttons.delete(name);
    }
  }

  private get muteButtonTitle(): string {
    return SoundManager.isMuted ? "SOUND: OFF" : "SOUND: ON";
  }

  private toggleMute(): void {
    SoundManager.isMuted = !SoundManager.isMuted;
    const button = this.buttons.get("muteButton");
    const lbl = button?.children.find((c): c is LabelNode => c instanceof LabelNode);
    if (lbl) lbl.text = this.muteButtonTitle;
  }

  private createButton(text: string): Node {
    const cs = this.cs;
    const container = new Node();
    const background = ShapeNode.rect(BUTTON_WIDTH * cs, BUTTON_HEIGHT * cs, 8 * cs);
    background.fillColor = white(0.2);
    background.strokeColor = Colors.yellow;
    background.lineWidth = 2 * cs;
    container.addChild(background);
    container.addChild(label(text, 22 * cs, Colors.white, { v: "center" }));
    return container;
  }

  /** Tappable button on the camera (or inside an overlay on the camera) */
  private addButton(parent: Node, name: string, text: string, position: Point, zPosition = 0): Node {
    const button = this.createButton(text);
    button.name = name;
    button.position = position;
    button.zPosition = zPosition;
    parent.addChild(button);
    this.buttons.set(name, button);
    return button;
  }

  /** Name of the button under a camera-space point */
  private buttonAt(point: Point): string | null {
    const cs = this.cs;
    for (const [name, button] of this.buttons) {
      const origin = button.parent?.position ?? { x: 0, y: 0 };
      const x = point.x - origin.x - button.position.x;
      const y = point.y - origin.y - button.position.y;
      if (Math.abs(x) <= (BUTTON_WIDTH * cs) / 2 && Math.abs(y) <= (BUTTON_HEIGHT * cs) / 2) return name;
    }
    return null;
  }

  gameOver(): void {
    // Base hit and last life lost can both happen in the same frame
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.lockEndScreenInput();
    this.hideFreezeLabels();
    this.releaseControllerTouches();
    SoundManager.stopGameplaySounds();
    setConsecutiveLosses(consecutiveLosses + 1);

    // No high score with cheats on
    this.isNewHighScore = !CheatSettings.isActive && this.bestScore > GameSettings.highScore;
    if (this.isNewHighScore) GameSettings.highScore = this.bestScore;
    this.showGameOverScreen();
  }

  // MARK: - Game over screen

  /** Big "GAME OVER" with score and high score for 10 seconds (with its tune), then the statistics */
  private showGameOverScreen(): void {
    const cs = this.cs;
    const seconds = 10;
    const screen = new Node();
    screen.zPosition = 300;
    screen.alpha = 0;
    this.gameCamera.addChild(screen);
    this.gameOverScreen = screen;

    screen.addChild(new SpriteNode(null, white(0, 0.88), { width: this.size.width * cs * 1.5, height: this.size.height * cs * 1.5 }));
    screen.run(Action.fadeIn(0.4));

    // "GAME OVER": letters drop in one by one and bounce, then glow
    const text = [..."GAME OVER"];
    const spacing = 46 * cs;
    const lettersY = 70 * cs;
    text.forEach((char, i) => {
      if (char === " ") return;
      const letter = label(char, 66 * cs, Colors.red, { v: "center" });
      letter.position = { x: (i - (text.length - 1) / 2) * spacing, y: lettersY + 300 * cs };
      letter.alpha = 0;
      screen.addChild(letter);
      const drop = Action.moveToY(lettersY, 0.45).ease("easeIn");
      const bounce = Action.sequence([Action.moveBy(0, 18 * cs, 0.12), Action.moveBy(0, -18 * cs, 0.12)]);
      const glow = Action.repeatForever(
        Action.sequence([
          Action.run(() => (letter.fontColor = rgb(1.0, 0.25, 0.2))),
          Action.scaleTo(1.08, 0.5),
          Action.run(() => (letter.fontColor = rgb(0.6, 0, 0))),
          Action.scaleTo(1.0, 0.5),
        ]),
      );
      letter.run(Action.sequence([Action.wait(0.3 + i * 0.12), Action.group([Action.fadeIn(0.2), drop]), bounce, glow]));
    });

    const infoDelay = 0.3 + text.length * 0.12 + 0.4;
    const addInfo = (s: string, fontSize: number, color: Color, y: number, delay: number) => {
      const lbl = label(s, fontSize * cs, color, { v: "center" });
      lbl.position = { x: 0, y: y * cs };
      lbl.alpha = 0;
      screen.addChild(lbl);
      lbl.run(Action.sequence([Action.wait(delay), Action.fadeIn(0.4)]));
      return lbl;
    };
    addInfo(this.isTwoPlayer ? `1P: ${this.scores[0]}    2P: ${this.scores[1]}` : `SCORE: ${this.score}`, 28, Colors.white, -10, infoDelay);
    addInfo(`HIGH SCORE: ${GameSettings.highScore}`, 30, rgb(1.0, 0.84, 0.0), -55, infoDelay + 0.3);

    if (this.isNewHighScore) {
      const record = addInfo("NEW HIGH SCORE!", 26, Colors.magenta, -100, infoDelay + 0.6);
      record.run(
        Action.sequence([
          Action.wait(infoDelay + 1.0),
          Action.run(() => this.showBonusStars({ x: 0, y: -100 * cs }, 310)),
          Action.repeatForever(Action.sequence([Action.fadeAlpha(0.25, 0.3), Action.fadeAlpha(1.0, 0.3)])),
        ]),
      );
    }

    // Continues: replay this level, or start again from level 1 when none are left
    const continuesText = this.continues > 0 ? `CONTINUES LEFT: ${this.continues}` : "NO CONTINUES LEFT - BACK TO LEVEL 1";
    addInfo(continuesText, 18, this.continues > 0 ? Colors.green : Colors.orange, -128, infoDelay + 0.6);

    let secondsLeft = seconds;
    const hint = GameState.touchControls ? "Tap to continue" : "Press Enter to continue";
    const countdown = addInfo(`${hint}  ${secondsLeft}`, 16, Colors.lightGray, -155, infoDelay + 0.6);
    const tick = Action.sequence([
      Action.wait(1.0),
      Action.run(() => {
        secondsLeft -= 1;
        countdown.text = `${hint}  ${Math.max(secondsLeft, 0)}`;
      }),
    ]);
    screen.run(Action.repeat(tick, seconds), "countdown");
    screen.run(Action.sequence([Action.wait(seconds), Action.run(() => this.finishGameOverScreen())]), "finish");

    SoundManager.playGameOver();
  }

  /** Leave the game over screen and show the statistics */
  private finishGameOverScreen(): void {
    const screen = this.gameOverScreen;
    if (!screen) return;
    this.gameOverScreen = null;
    this.lockEndScreenInput();
    SoundManager.stopGameOver();
    screen.removeAllActions();
    screen.run(Action.sequence([Action.fadeOut(0.3), Action.removeFromParent()]));
    this.showScoreBreakdown("GAME OVER", Colors.red, true);
  }

  /** Two players: the one with more kills this level gets a random power-up for the next level */
  private awardKillBonus(): KillBonus | null {
    const player2 = this.player2Tank;
    if (!this.isTwoPlayer || !player2) return null;
    const kills1 = sumKills(this.killsByPlayer[0]);
    const kills2 = sumKills(this.killsByPlayer[1]);
    if (kills1 === kills2) return null;

    const winnerIndex = kills1 > kills2 ? 0 : 1;
    const winner = winnerIndex === 0 ? this.playerTank : player2;
    const candidates = [PowerUpType.Car, PowerUpType.Machinegun, PowerUpType.Laser, PowerUpType.Gun];
    const useful = candidates.filter((type) => {
      switch (type) {
        case PowerUpType.Car:
          return winner.speedMultiplier < 2.5;
        case PowerUpType.Machinegun:
          return winner.machinegunCount < 3;
        case PowerUpType.Gun:
          return winner.bulletPower < 2;
        default:
          return true;
      }
    });
    const type = randomElement(useful.length ? useful : candidates) ?? PowerUpType.Car;
    new PowerUp({ x: 0, y: 0 }, type).applyTo(winner);
    // Awarded as the round ends: the laser is for the whole next round
    if (type === PowerUpType.Laser) winner.laserRounds = C.laserRoundsOnPickup + 1;
    winner.drawTank();
    return { playerIndex: winnerIndex, type };
  }

  private bonusDescription(type: PowerUpType): string {
    switch (type) {
      case PowerUpType.Car:
        return "🚗 SPEED";
      case PowerUpType.Machinegun:
        return "💥 MACHINEGUN";
      case PowerUpType.Laser:
        return "🔦 LASER";
      case PowerUpType.Gun:
        return "🔫 GUN";
      default:
        return "";
    }
  }

  /** Kill rows ([tank icon] × count : points); returns the next free Y */
  private addKillRows(kills: KillCounts, x: number, y: number, lineHeight: number): number {
    let yPos = y;
    const types = [EnemyType.Regular, EnemyType.Fast, EnemyType.Armored, EnemyType.Power, EnemyType.Heavy, EnemyType.Alien, EnemyType.Boss];
    for (const type of types) {
      const count = kills.get(type) ?? 0;
      if (count <= 0) continue;
      const row = this.createKillRow(type, count, scoreForEnemyType(type) * count);
      row.position = { x, y: yPos };
      row.zPosition = 200;
      this.gameCamera.addChild(row);
      yPos -= lineHeight;
    }
    return yPos;
  }

  private addBreakdownLabel(text: string, fontSize: number, color: Color, position: Point): LabelNode {
    const lbl = label(text, fontSize, color);
    lbl.position = position;
    lbl.zPosition = 200;
    this.gameCamera.addChild(lbl);
    return lbl;
  }

  /** Two-player statistics: one column of kills per player, plus the kill bonus */
  private addTwoPlayerKillColumns(y: number, lineHeight: number, bonus: KillBonus | null): number {
    const cs = this.cs;
    const columnX = [-140 * cs, 140 * cs];
    const colors = [tankColorOf(GameSettings.playerTankColor), tankColorOf(GameSettings.player2TankColor)];
    const ends: number[] = [];
    for (let index = 0; index < 2; index++) {
      let yPos = y;
      const x = columnX[index];
      this.addBreakdownLabel(`${index + 1}P: ${sumKills(this.killsByPlayer[index])} KILLS`, 20 * cs, colors[index], { x, y: yPos });
      yPos -= lineHeight * 1.1;
      yPos = this.addKillRows(this.killsByPlayer[index], x, yPos, lineHeight);
      // The bonus sits beside the winner's column (outer side)
      if (bonus && bonus.playerIndex === index) {
        const side = index === 0 ? -1 : 1;
        this.showBonusAnimation(this.bonusDescription(bonus.type), { x: x + side * 190 * cs, y: y - lineHeight * 1.2 }, lineHeight);
      }
      ends.push(yPos);
    }
    return Math.min(...ends);
  }

  /** "BONUS!" pops in under the winner's kills, then keeps pulsing in rainbow colors */
  private showBonusAnimation(text: string, position: Point, lineHeight: number): void {
    const cs = this.cs;
    const container = new Node();
    container.position = position;
    container.zPosition = 210;
    container.setScale(0.01);
    container.alpha = 0;
    this.gameCamera.addChild(container);

    const bonusLabel = label("BONUS!", 26 * cs, Colors.yellow);
    container.addChild(bonusLabel);
    const powerUpLabel = label(text, 18 * cs, Colors.white);
    powerUpLabel.position = { x: 0, y: -lineHeight };
    container.addChild(powerUpLabel);

    const rainbow = [Colors.yellow, Colors.orange, Colors.red, Colors.magenta, Colors.cyan, Colors.green];
    bonusLabel.run(Action.repeatForever(Action.sequence(rainbow.flatMap((c) => [Action.run(() => (bonusLabel.fontColor = c)), Action.wait(0.12)]))));

    const popIn = Action.group([Action.fadeIn(0.25), Action.sequence([Action.scaleTo(1.4, 0.25), Action.scaleTo(1.0, 0.15)])]);
    const pulse = Action.repeatForever(Action.sequence([Action.scaleTo(1.12, 0.4), Action.scaleTo(1.0, 0.4)]));
    const burst = Action.run(() => {
      SoundManager.playPowerUp();
      this.showBonusStars({ x: position.x, y: position.y + 8 * cs });
    });
    container.run(Action.sequence([Action.wait(0.8), burst, popIn, pulse]));
  }

  /** Stars flying out of a label */
  private showBonusStars(position: Point, zPosition = 205): void {
    const cs = this.cs;
    const colors = [Colors.yellow, Colors.orange, Colors.cyan, Colors.magenta];
    for (let i = 0; i < 12; i++) {
      const star = label("★", 16 * cs, colors[i % 4], { v: "center" });
      star.fontName = null;
      star.position = { ...position };
      star.zPosition = zPosition;
      this.gameCamera.addChild(star);
      const angle = (i / 12) * Math.PI * 2;
      const dist = randomIn(50, 80) * cs;
      const fly = Action.moveBy(Math.cos(angle) * dist, Math.sin(angle) * dist, 0.7).ease("easeOut");
      star.run(Action.sequence([Action.group([fly, Action.rotateBy(Math.PI * 2, 0.7), Action.fadeOut(0.7)]), Action.removeFromParent()]));
    }
  }

  /** Statistics after a level: kills per enemy type, scores and buttons */
  private showScoreBreakdown(title: string, titleColor: Color, showRestart: boolean, bonus: KillBonus | null = null): void {
    const cs = this.cs;
    const lineHeight = 28 * cs;
    let yPos = 140 * cs;

    this.addBreakdownLabel(`Level ${this.level}`, 28 * cs, Colors.white, { x: 0, y: yPos });
    yPos -= lineHeight * 1.5;
    this.addBreakdownLabel(title, 36 * cs, titleColor, { x: 0, y: yPos });
    yPos -= lineHeight * 1.5;

    if (this.isTwoPlayer) yPos = this.addTwoPlayerKillColumns(yPos, lineHeight, bonus);
    else yPos = this.addKillRows(this.killsByType, 0, yPos, lineHeight);

    yPos -= lineHeight * 0.3;
    const separator = new SpriteNode(null, Colors.white, { width: 200 * cs, height: 2 * cs });
    separator.position = { x: 0, y: yPos };
    separator.zPosition = 200;
    this.gameCamera.addChild(separator);
    yPos -= lineHeight * 0.8;

    const columns = this.isTwoPlayer
      ? [
          { x: -140 * cs, index: 0 },
          { x: 140 * cs, index: 1 },
        ]
      : [{ x: 0, index: 0 }];
    for (const column of columns) {
      const roundScore = this.scores[column.index] - this.levelStartScores[column.index];
      this.addBreakdownLabel(`Round Score: ${roundScore}`, 20 * cs, Colors.yellow, { x: column.x, y: yPos });
      this.addBreakdownLabel(`Total Score: ${this.scores[column.index]}`, 22 * cs, Colors.cyan, { x: column.x, y: yPos - lineHeight });
    }
    yPos -= lineHeight * 2;

    if (showRestart && this.isNewHighScore) {
      const highScoreLabel = this.addBreakdownLabel(`HIGHSCORE ${this.bestScore}`, 26 * cs, Colors.magenta, { x: 0, y: yPos });
      highScoreLabel.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(0.2, 0.3), Action.fadeAlpha(1.0, 0.3)])));
      yPos -= lineHeight;
    }
    yPos -= lineHeight * 0.5;

    if (showRestart) {
      // CONTINUE (same level) next to NEW GAME (level 1), while continues are left
      if (this.continues > 0) {
        this.addButton(this.gameCamera, "continueButton", `CONTINUE (${this.continues})`, { x: -100 * cs, y: yPos }, 200);
        this.addButton(this.gameCamera, "restartButton", "NEW GAME", { x: 100 * cs, y: yPos }, 200);
      } else {
        this.addButton(this.gameCamera, "restartButton", "NEW GAME", { x: 0, y: yPos }, 200);
      }
    } else {
      this.addButton(this.gameCamera, "nextLevelButton", "NEXT LEVEL", { x: 0, y: yPos }, 200);
    }
    yPos -= 60 * cs;
    this.addButton(this.gameCamera, "menuButton", "MENU", { x: 0, y: yPos }, 200);

    this.addBreakdownBackground(180 * cs, yPos - 40 * cs);
  }

  /** Dim the game behind the statistics and put them on a framed panel */
  private addBreakdownBackground(top: number, bottom: number): void {
    const cs = this.cs;
    const screenSize = { width: this.size.width * cs, height: this.size.height * cs };
    const dim = new SpriteNode(null, white(0, 0.6), { width: screenSize.width * 1.5, height: screenSize.height * 1.5 });
    dim.zPosition = 198;
    this.gameCamera.addChild(dim);

    // Two players: wide enough for both columns and the bonus beside them
    const width = Math.min((this.isTwoPlayer ? 840 : 380) * cs, screenSize.width * 0.96);
    const panel = ShapeNode.rect(width, top - bottom, 14 * cs);
    panel.fillColor = rgb(0.05, 0.05, 0.12, 0.95);
    panel.strokeColor = this.showGzhelBorder ? Colors.blue : Colors.yellow;
    panel.lineWidth = 3 * cs;
    panel.position = { x: 0, y: (top + bottom) / 2 };
    panel.zPosition = 199;
    this.gameCamera.addChild(panel);
  }

  /** Row: [tank icon] × count : points */
  private createKillRow(type: EnemyType, count: number, points: number): Node {
    const cs = this.cs;
    const container = new Node();
    const icon = this.createMiniTankIcon(type, 20 * cs);
    icon.position = { x: -80 * cs, y: 0 };
    container.addChild(icon);
    const countLabel = label(`× ${count}`, 16 * cs, Colors.white, { h: "left", v: "center" });
    countLabel.position = { x: -50 * cs, y: 0 };
    container.addChild(countLabel);
    const pointsLabel = label(`: ${points}`, 16 * cs, Colors.yellow, { h: "left", v: "center" });
    pointsLabel.position = { x: 20 * cs, y: 0 };
    container.addChild(pointsLabel);
    return container;
  }

  private createMiniTankIcon(type: EnemyType, size: number): Node {
    const colors: Record<EnemyType, Color> = {
      [EnemyType.Regular]: rgb(0.75, 0.75, 0.75),
      [EnemyType.Fast]: rgb(0.6, 0.8, 1.0),
      [EnemyType.Armored]: rgb(0.0, 0.6, 0.0),
      [EnemyType.Power]: rgb(1.0, 0.0, 0.0),
      [EnemyType.Heavy]: rgb(0.2, 0.2, 0.2),
      [EnemyType.Boss]: rgb(0.5, 0.0, 0.5),
      [EnemyType.Alien]: rgb(0.4, 0.9, 0.4),
      [EnemyType.Gzhel]: rgb(0.2, 0.45, 1.0),
    };
    const color = colors[type];
    const container = new Node();
    const part = (w: number, h: number, x: number, y: number) => {
      const node = new SpriteNode(null, color, { width: w, height: h });
      node.position = { x, y };
      container.addChild(node);
    };
    part(size * 0.6, size * 0.5, 0, 0); // Body
    part(size * 0.15, size * 0.7, -size * 0.35, 0); // Tracks
    part(size * 0.15, size * 0.7, size * 0.35, 0);
    part(size * 0.15, size * 0.4, 0, size * 0.35); // Barrel
    return container;
  }

  // MARK: - Freeze countdown HUD

  private setupFreezeLabels(): void {
    const playerColor = rgb(1.0, 0.45, 0.45);
    this.playerFreezeLabels = Array.from({ length: this.playerCount }, () => this.makeFreezeLabel(playerColor));
    this.enemyFreezeLabel = this.makeFreezeLabel(Colors.cyan);
    if (this.isTwoPlayer) {
      this.lifeHintLabels = [1, 2].map((number) => {
        const lbl = this.makeFreezeLabel(Tank.colorForPlayer(number));
        lbl.text = `${number}P: PRESS FIRE TO TAKE A LIFE`;
        lbl.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(0.35, 0.4), Action.fadeAlpha(1.0, 0.4)])));
        return lbl;
      });
    }
  }

  private makeFreezeLabel(color: Color): LabelNode {
    const lbl = label("", 20 * this.cs, color, { v: "top" });
    lbl.zPosition = 150; // Below pause / game over overlays
    lbl.isHidden = true;
    this.gameCamera.addChild(lbl);
    return lbl;
  }

  /** "❄ YOU ARE FROZEN 27s" / "❄ ENEMIES FROZEN 12s" stacked at the top of the screen */
  private updateFreezeLabels(): void {
    const hintsWanted = this.playerTanks.map((p) => this.canStealLife(p));
    const anything =
      this.playerFreezeTimers.some((t) => t > 0) ||
      this.freezeTimer > 0 ||
      hintsWanted.includes(true) ||
      this.playerFreezeLabels.some((l) => !l.isHidden) ||
      this.enemyFreezeLabel?.isHidden === false ||
      this.lifeHintLabels.some((l) => !l.isHidden);
    if (!anything) return;

    const ref = { y: (this.size.height / 2 - 10) * this.cs };
    this.playerFreezeLabels.forEach((lbl, index) => {
      const title = this.isTwoPlayer ? `${index + 1}P FROZEN` : "YOU ARE FROZEN";
      this.shownPlayerFreezeSeconds[index] = this.updateFreezeLabel(lbl, this.playerFreezeTimers[index], title, this.shownPlayerFreezeSeconds[index], ref);
    });
    if (this.enemyFreezeLabel) {
      this.shownEnemyFreezeSeconds = this.updateFreezeLabel(this.enemyFreezeLabel, this.freezeTimer, "ENEMIES FROZEN", this.shownEnemyFreezeSeconds, ref);
    }
    this.lifeHintLabels.forEach((lbl, index) => {
      const wanted = index < hintsWanted.length && hintsWanted[index];
      lbl.isHidden = !wanted;
      if (wanted) {
        lbl.position = { x: 0, y: ref.y };
        ref.y -= lbl.fontSize * 1.3;
      }
    });
  }

  /** Returns the seconds now shown */
  private updateFreezeLabel(lbl: LabelNode, timer: number, title: string, shownSeconds: number, ref: { y: number }): number {
    if (timer <= 0) {
      lbl.isHidden = true;
      return -1;
    }
    const seconds = Math.floor((timer + 59) / 60);
    if (seconds !== shownSeconds) lbl.text = `❄ ${title} ${seconds}s`;
    lbl.position = { x: 0, y: ref.y };
    lbl.isHidden = false;
    ref.y -= lbl.fontSize * 1.3;
    return seconds;
  }

  private hideFreezeLabels(): void {
    for (const l of this.playerFreezeLabels) l.isHidden = true;
    if (this.enemyFreezeLabel) this.enemyFreezeLabel.isHidden = true;
    for (const l of this.lifeHintLabels) l.isHidden = true;
  }

  private get scoreText(): string {
    return this.isTwoPlayer ? `1P: ${this.scores[0]}   2P: ${this.scores[1]}` : `Score: ${this.score}`;
  }

  private updateHud(force = false): void {
    const text = this.scoreText;
    if (!force && text === this.lastHudText) return;
    this.lastHudText = text;
    if (this.scoreLabel) {
      this.scoreLabel.text = text;
      this.updateScorePlate();
    }
    if (!GameState.touchControls) GameScene.hudListener?.({ text, plate: this.showGzhelBorder || this.bonusStage });
  }

  private updateUI(): void {
    this.updateFreezeLabels();
    this.updateHud();

    const powerUps = this.sidebarPowerUps(this.playerTank);
    const friend = this.friends.find((f) => f.isAlive);
    if (friend) powerUps.friendHits = friend.health;
    const powerUps2 = this.player2Tank ? this.sidebarPowerUps(this.player2Tank) : emptyPowerUpData();
    this.sidebar.update(this.enemySpawner.remainingEnemies, this.playerTank.lives, this.player2Tank?.lives ?? 0, this.level, powerUps, powerUps2);
  }

  private sidebarPowerUps(player: Tank): PowerUpData {
    const p = emptyPowerUpData();
    p.starCount = player.starCount;
    p.bossFireBoost = player.bossFireBoost;
    p.machinegunCount = player.machinegunCount;
    p.hasGun = player.bulletPower >= 2;
    p.hasShip = player.canSwim;
    p.hasSaw = player.canDestroyTrees;
    p.hasLaser = player.hasLaser;
    p.hasMagic = player.hasMagic;
    // Cars: +0.3 each on top of the start speed (soccer balls raise the start speed itself)
    p.speedBoosts = Math.max(Math.round((player.speedMultiplier - player.baseSpeedMultiplier) / 0.3), 0);
    p.ballBoosts = Math.max(Math.round((player.baseSpeedMultiplier - 1.0) / C.ballSpeedBoost), 0);
    return p;
  }

  /** Add score to a player (player 1 if unknown) and award their bonus lives */
  addScore(points: number, player: Tank | null): void {
    const index = player?.playerNumber === 2 ? 1 : 0;
    const oldMilestone = GameScene.lifeMilestones(this.scores[index]);
    this.scores[index] += points;
    const newMilestone = GameScene.lifeMilestones(this.scores[index]);
    if (newMilestone > oldMilestone) {
      const bonusLives = newMilestone - oldMilestone;
      (index === 1 ? this.player2Tank : this.playerTank)?.addLives(bonusLives);
      this.showEffect(`+${bonusLives} LIFE!`, Colors.magenta);
    }
  }

  private get allTanks(): Tank[] {
    if (this.allTanksDirty) {
      this.cachedAllTanks = [...this.playerTanks, ...this.enemyTanks, ...this.friends];
      this.allTanksDirty = false;
    }
    return this.cachedAllTanks;
  }

  invalidateAllTanksCache(): void {
    this.allTanksDirty = true;
  }

  // MARK: - Touch input

  touchesBegan(touches: Touch[]): void {
    for (const touch of touches) {
      if (!this.isGamePaused && !this.isGameOver) {
        // Touch controls
        for (const controller of [this.touchController, this.touchController2]) {
          if (!controller || !controller.parent) continue;
          if (controller.touchBegan(touch.id, this.screenToNode(touch.location, controller))) {
            this.controllerTouches.set(touch.id, controller);
            break;
          }
        }
        continue;
      }
      this.handleMenuTap(this.screenToNode(touch.location, this.gameCamera));
    }
  }

  touchesMoved(touches: Touch[]): void {
    for (const touch of touches) {
      const controller = this.controllerTouches.get(touch.id);
      controller?.touchMoved(touch.id, this.screenToNode(touch.location, controller));
    }
  }

  touchesEnded(touches: Touch[]): void {
    for (const touch of touches) {
      const controller = this.controllerTouches.get(touch.id);
      if (!controller) continue;
      controller.touchEnded(touch.id);
      this.controllerTouches.delete(touch.id);
    }
  }

  /** Taps on the pause menu and the end screens */
  private handleMenuTap(location: Point): void {
    if (this.isGamePaused) {
      switch (this.buttonAt(location)) {
        case "menuButton":
          return this.goToMenu();
        case "muteButton":
          return this.toggleMute(); // Stay paused
        default:
          return this.togglePause(); // Resume, or a tap on the background
      }
    }

    // Just after the round ended: ignore stray taps
    if (this.isGameOver && this.isEndScreenInputLocked) return;
    if (this.gameOverScreen) {
      this.finishGameOverScreen();
      return;
    }
    if (!this.isGameOver) return;

    switch (this.buttonAt(location)) {
      case "menuButton":
        return this.goToMenu();
      case "continueButton":
        return this.continueGame();
      case "restartButton":
        return this.restartGame();
      case "nextLevelButton":
        return this.nextLevel();
    }
    // Anywhere else: next level if won, otherwise continue (or a new game without continues)
    if (this.didWinLevel) this.nextLevel();
    else this.continueOrRestart();
  }

  // MARK: - Scene changes

  private present(scene: Scene): void {
    this.view?.present(scene, 0.5);
  }

  private nextLevel(): void {
    const powerUps = this.carriedPowerUps(this.playerTank);
    const powerUps2 = this.player2Tank ? this.carriedPowerUps(this.player2Tank) : defaultPowerUps();
    // The cat played with the egg: the next level is a Gzhel level (one level only)
    const earnedGzhel = this.playerCollectedEasterEgg;
    // The UFO escaped: the next level has the alien at the base (an alien level is followed by a normal one)
    const ufoEscaped = this.ufoEscapedThisLevel || this.ufos.length > 0;
    const nextAlienMode = ufoEscaped && !this.alienMode;

    // Crazy mode brings new friends every level
    const friendTank = CheatSettings.isCrazy ? undefined : this.friends.find((f) => f.isAlive);
    const friend: FriendCarry | null =
      friendTank && friendTank.isAlive
        ? {
            health: friendTank.health,
            maxHealth: friendTank.maxHealth,
            starCount: friendTank.starCount,
            machinegunCount: friendTank.machinegunCount,
            bulletPower: friendTank.bulletPower,
            speedMultiplier: friendTank.speedMultiplier,
            canSwim: friendTank.canSwim,
            canDestroyTrees: friendTank.canDestroyTrees,
          }
        : null;

    // Five Gzhel levels in a row open the secret Gorodets bonus stage
    let streak = this.showGzhelBorder ? this.gzhelStreak + 1 : 0;
    const nextIsBonus = streak >= C.gzhelLevelsForBonusStage;
    if (nextIsBonus) streak = 0;

    this.present(
      new GameScene(this.size, {
        level: this.level + 1,
        score: this.score,
        lives: this.playerTank.lives,
        sessionSeed: this.sessionSeed,
        powerUps,
        gzhelBorder: earnedGzhel && !nextIsBonus,
        alienMode: nextAlienMode,
        playerCount: this.playerCount,
        player2Lives: this.player2Tank?.lives ?? 3,
        player2PowerUps: powerUps2,
        player2Score: this.scores[1],
        friend,
        gzhelStreak: streak,
        bonusStage: nextIsBonus,
        continues: this.continues,
      }),
    );
  }

  private continueOrRestart(): void {
    if (this.continues > 0) this.continueGame();
    else this.restartGame();
  }

  /** CONTINUE: replay the level where the game was lost (same map), fresh lives, score 0 */
  private continueGame(): void {
    if (this.continues <= 0) return this.restartGame();
    SoundManager.stopGameOver();
    this.present(
      new GameScene(this.size, {
        level: this.level,
        score: 0,
        lives: GameScene.startLives(),
        sessionSeed: this.sessionSeed,
        powerUps: GameScene.startPowerUps(this.keptAfterDeath(this.playerTank)),
        playerCount: this.playerCount,
        player2Lives: GameScene.startLives(),
        player2PowerUps: GameScene.startPowerUps(this.player2Tank ? this.keptAfterDeath(this.player2Tank) : defaultPowerUps()),
        continues: this.continues - 1,
        startSteelBase: CheatSettings.active.steelBase,
      }),
    );
  }

  /** NEW GAME: level 1 with a new map set and a full set of continues */
  private restartGame(): void {
    SoundManager.stopGameOver();
    this.present(GameScene.newGame(this.size, this.playerCount));
  }

  private goToMenu(): void {
    SoundManager.stopGameOver();
    setConsecutiveLosses(0);
    SoundManager.stopGameplaySounds();
    SoundManager.stopBackgroundMusic();
    this.present(new MenuScene(this.size));
  }

  // MARK: - Keyboard

  /** Key → (player, direction or null for fire). One player: both players' keys drive the single tank. */
  private keyBinding(code: string): { player: number; direction: Direction | null } | null {
    if (!this.keyMap) {
      const map = new Map<string, { player: number; direction: Direction | null }>();
      for (let player = 0; player < 2; player++) {
        for (const action of KEY_ACTIONS) {
          const key = GameSettings.key(action, player);
          if (!map.has(key)) map.set(key, { player: this.isTwoPlayer ? player : 0, direction: KeyActionInfo[action].direction });
        }
      }
      this.keyMap = map;
    }
    return this.keyMap.get(code) ?? null;
  }

  keyDown(code: string, repeat: boolean): boolean {
    if ((code === "Enter" || code === "NumpadEnter") && this.isGameOver) {
      if (repeat || this.isEndScreenInputLocked) return true; // Probably still firing: don't skip the screen
      if (this.gameOverScreen) this.finishGameOverScreen();
      else if (this.didWinLevel) this.nextLevel();
      else this.continueOrRestart();
      return true;
    }

    if (code === "Escape" || code === "KeyP") {
      if (!repeat && !this.isGameOver) this.togglePause();
      return true;
    }

    const binding = this.keyBinding(code);
    if (!binding) return false;
    if (binding.direction !== null) {
      this.pressedDirectionKeys.add(code);
      this.keyboardDirection[binding.player] = binding.direction;
    } else {
      this.keyboardFiring[binding.player] = true;
    }
    return true;
  }

  keyUp(code: string): void {
    const binding = this.keyBinding(code);
    if (!binding) return;
    if (binding.direction !== null) {
      this.pressedDirectionKeys.delete(code);
      this.keyboardDirection[binding.player] = this.directionFromPressedKeys(binding.player);
    } else {
      this.keyboardFiring[binding.player] = false;
    }
  }

  /** Direction of a still-held key of this player (after another key was released) */
  private directionFromPressedKeys(player: number): Direction | null {
    for (const code of this.pressedDirectionKeys) {
      const binding = this.keyBinding(code);
      if (binding && binding.player === player && binding.direction !== null) return binding.direction;
    }
    return null;
  }
}
