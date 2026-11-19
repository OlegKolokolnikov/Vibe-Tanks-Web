/**
 * Cheats, unlocked with the Konami code on the start menu (↑↑↓↓←→←→ B A, or the same swipes + two taps).
 * The settings are saved, but they only take effect after the code is entered (once per page load).
 */
export interface CheatConfig {
  // Players
  playerSpeed: number;
  playerFireRate: number;
  playerLives: number;
  startLevel: number;

  // Power-ups every player starts the game with
  stars: number;
  machineguns: number;
  cars: number;
  gun: boolean;
  ship: boolean;
  saw: boolean;
  shield: boolean;
  laser: boolean;
  magic: boolean;
  steelBase: boolean;

  // Enemies
  enemySpeed: number;
  enemyFireRate: number;
  enemiesTakePowerUps: boolean;
  enemyCount: number; // 0 = normal for the level
  enemiesOnScreen: number; // 0 = normal (5)
  enemyArmor: number; // Extra hits for every enemy
  ufoEnabled: boolean;

  crazyMode: boolean;
}

export function defaultCheatConfig(): CheatConfig {
  return {
    playerSpeed: 1,
    playerFireRate: 1,
    playerLives: 3,
    startLevel: 1,
    stars: 0,
    machineguns: 0,
    cars: 0,
    gun: false,
    ship: false,
    saw: false,
    shield: false,
    laser: false,
    magic: false,
    steelBase: false,
    enemySpeed: 1,
    enemyFireRate: 1,
    enemiesTakePowerUps: true,
    enemyCount: 0,
    enemiesOnScreen: 0,
    enemyArmor: 0,
    ufoEnabled: true,
    crazyMode: false,
  };
}

const STORAGE_KEY = "vibetanks.cheatConfig";

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

class CheatSettingsStore {
  /** Speed and fire-rate multipliers the cheat screen offers */
  readonly factorSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  readonly livesSteps = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 99];
  readonly levelSteps = [...range(1, 10), 15, 20, 25, 30, 40, 50, 75, 100];
  readonly enemyCountSteps = [0, 1, 5, 10, 20, 30, 50, 75, 100, 200, 500, 1000];
  readonly onScreenSteps = range(0, 20);

  /** Entered the Konami code since the page was loaded */
  isUnlocked = false;

  private _config: CheatConfig;

  constructor() {
    this._config = defaultCheatConfig();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this._config = { ...this._config, ...(JSON.parse(raw) as Partial<CheatConfig>) };
    } catch {
      /* Storage unavailable or broken: defaults */
    }
  }

  get config(): CheatConfig {
    return { ...this._config };
  }

  set config(value: CheatConfig) {
    this._config = { ...value };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._config));
    } catch {
      /* Storage unavailable: lasts for this session only */
    }
  }

  reset(): void {
    this.config = defaultCheatConfig();
  }

  private get isDefault(): boolean {
    const d = defaultCheatConfig();
    return (Object.keys(d) as (keyof CheatConfig)[]).every((k) => d[k] === this._config[k]);
  }

  /** Cheats change the game (unlocked and something differs from normal). High scores aren't saved then. */
  get isActive(): boolean {
    return this.isUnlocked && !this.isDefault;
  }

  /** The settings the game plays with: normal ones when cheats are off */
  get active(): CheatConfig {
    return this.isActive ? this.config : defaultCheatConfig();
  }

  get isCrazy(): boolean {
    return this.active.crazyMode;
  }
}

export const CheatSettings = new CheatSettingsStore();
