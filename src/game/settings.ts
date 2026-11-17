import { rgb, type Color } from "../engine/color";
import { Direction } from "./direction";

/** localStorage wrapper that never throws (private mode, blocked storage) */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem("vibetanks." + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem("vibetanks." + key, value);
    } catch {
      /* Storage unavailable: setting lasts for this session only */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem("vibetanks." + key);
    } catch {
      /* ignore */
    }
  },
};

export type TankColor = "yellow" | "green" | "blue" | "purple";
export const TANK_COLORS: readonly TankColor[] = ["yellow", "green", "blue", "purple"];

export const TankColors: Record<TankColor, { displayName: string; color: Color }> = {
  yellow: { displayName: "Yellow", color: rgb(1.0, 0.84, 0.0) }, // Gold
  green: { displayName: "Green", color: rgb(0.2, 0.8, 0.2) },
  blue: { displayName: "Blue", color: rgb(0.3, 0.5, 1.0) },
  purple: { displayName: "Purple", color: rgb(0.7, 0.3, 0.9) },
};

/** Something a player can do with a key */
export type KeyAction = "up" | "down" | "left" | "right" | "fire";
export const KEY_ACTIONS: readonly KeyAction[] = ["up", "down", "left", "right", "fire"];

export const KeyActionInfo: Record<KeyAction, { displayName: string; direction: Direction | null }> = {
  up: { displayName: "UP", direction: Direction.Up },
  down: { displayName: "DOWN", direction: Direction.Down },
  left: { displayName: "LEFT", direction: Direction.Left },
  right: { displayName: "RIGHT", direction: Direction.Right },
  fire: { displayName: "FIRE", direction: null },
};

/** Where a player's fire button sits next to their joystick (two-player touch controls) */
export type FirePlacement = "above" | "below" | "inside" | "outside";
export const FIRE_PLACEMENTS: readonly FirePlacement[] = ["above", "below", "inside", "outside"];
export const FirePlacementNames: Record<FirePlacement, string> = {
  above: "FIRE ABOVE",
  below: "FIRE BELOW",
  inside: "FIRE INSIDE",
  outside: "FIRE OUTSIDE",
};

export function nextFirePlacement(p: FirePlacement): FirePlacement {
  return FIRE_PLACEMENTS[(FIRE_PLACEMENTS.indexOf(p) + 1) % FIRE_PLACEMENTS.length];
}

/** Stores and loads user preferences */
class GameSettingsStore {
  /** Number of volume steps (0 = off, maxVolumeLevel = 100%) */
  static readonly maxVolumeLevel = 10;

  /** Default keys (KeyboardEvent.code): player 1 WASD + Space, player 2 arrows + Enter */
  static readonly defaultKeys: Record<KeyAction, string>[] = [
    { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", fire: "Space" },
    { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fire: "Enter" },
  ];

  /** Keys that can't be assigned: Escape and P pause the game */
  static readonly reservedKeys = new Set(["Escape", "KeyP"]);

  /** Whether fire button and joystick positions are swapped */
  get controlsSwapped(): boolean {
    return store.get("controlsSwapped") === "1";
  }
  set controlsSwapped(value: boolean) {
    store.set("controlsSwapped", value ? "1" : "0");
  }

  /** Sound volume level, 0...maxVolumeLevel (default: full volume) */
  get volumeLevel(): number {
    const raw = store.get("volumeLevel");
    if (raw === null) return GameSettingsStore.maxVolumeLevel;
    const level = parseInt(raw, 10);
    return Number.isFinite(level) ? Math.min(Math.max(level, 0), GameSettingsStore.maxVolumeLevel) : GameSettingsStore.maxVolumeLevel;
  }
  set volumeLevel(value: number) {
    store.set("volumeLevel", String(Math.min(Math.max(Math.round(value), 0), GameSettingsStore.maxVolumeLevel)));
  }

  /** Best score ever (saved; 250 until someone beats it) */
  get highScore(): number {
    return Math.max(parseInt(store.get("highScore") ?? "0", 10) || 0, 250);
  }
  set highScore(value: number) {
    store.set("highScore", String(value));
  }

  /** All sound muted (volume level is kept, so unmuting restores it) */
  get isMuted(): boolean {
    return store.get("isMuted") === "1";
  }
  set isMuted(value: boolean) {
    store.set("isMuted", value ? "1" : "0");
  }

  private static isTankColor(value: string | null): value is TankColor {
    return value !== null && (TANK_COLORS as readonly string[]).includes(value);
  }

  /** Player tank color preference */
  get playerTankColor(): TankColor {
    const raw = store.get("playerTankColor");
    return GameSettingsStore.isTankColor(raw) ? raw : "yellow";
  }
  set playerTankColor(value: TankColor) {
    // Same color as player 2 is not allowed
    if (value === this.player2TankColor) return;
    store.set("playerTankColor", value);
  }

  /** Player 2 tank color (default green). Never the same as player 1's color. */
  get player2TankColor(): TankColor {
    const player1 = this.playerTankColor;
    const raw = store.get("player2TankColor");
    if (GameSettingsStore.isTankColor(raw) && raw !== player1) return raw;
    const preferred: TankColor[] = ["green", "blue", "purple", "yellow"];
    return preferred.find((c) => c !== player1) ?? "green";
  }
  set player2TankColor(value: TankColor) {
    if (value === this.playerTankColor) return;
    store.set("player2TankColor", value);
  }

  // MARK: Keyboard keys (per player)

  private keyStorageKey(action: KeyAction, player: number): string {
    return `key_p${player + 1}_${action}`;
  }

  /** Key for an action of a player (0 = player 1, 1 = player 2) */
  key(action: KeyAction, player: number): string {
    return store.get(this.keyStorageKey(action, player)) || GameSettingsStore.defaultKeys[player][action];
  }

  /** Assign a key. If another action (of either player) already uses it, the two swap keys. */
  setKey(key: string, action: KeyAction, player: number): void {
    if (GameSettingsStore.reservedKeys.has(key)) return;
    const previous = this.key(action, player);
    for (let otherPlayer = 0; otherPlayer < 2; otherPlayer++) {
      for (const otherAction of KEY_ACTIONS) {
        if (otherPlayer === player && otherAction === action) continue;
        if (this.key(otherAction, otherPlayer) === key) {
          store.set(this.keyStorageKey(otherAction, otherPlayer), previous);
        }
      }
    }
    store.set(this.keyStorageKey(action, player), key);
  }

  resetKeys(): void {
    for (let player = 0; player < 2; player++) {
      for (const action of KEY_ACTIONS) store.remove(this.keyStorageKey(action, player));
    }
  }

  /** Short name of a key for the controls screen */
  static keyName(code: string): string {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return "NUM " + code.slice(6);
    const names: Record<string, string> = {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Space: "SPACE",
      Enter: "ENTER",
      NumpadEnter: "ENTER",
      Tab: "TAB",
      Backspace: "DELETE",
      ShiftLeft: "L-SHIFT",
      ShiftRight: "R-SHIFT",
      ControlLeft: "L-CTRL",
      ControlRight: "R-CTRL",
      AltLeft: "L-ALT",
      AltRight: "R-ALT",
      MetaLeft: "L-CMD",
      MetaRight: "R-CMD",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Semicolon: ";",
      Quote: "'",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Minus: "-",
      Equal: "=",
      Backquote: "`",
    };
    return names[code] ?? code.toUpperCase();
  }

  // MARK: Touch layout (two-player games)

  firePlacement(player: number): FirePlacement {
    const raw = store.get(`firePlacement_p${player + 1}`);
    return raw && (FIRE_PLACEMENTS as readonly string[]).includes(raw) ? (raw as FirePlacement) : "above";
  }

  setFirePlacement(placement: FirePlacement, player: number): void {
    store.set(`firePlacement_p${player + 1}`, placement);
  }
}

export const GameSettings = new GameSettingsStore();
export const SettingsInfo = GameSettingsStore;

export function tankColorOf(c: TankColor): Color {
  return TankColors[c].color;
}
