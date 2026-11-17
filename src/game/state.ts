import type { GameMap } from "./map";

/** Global game flags shared by the game objects (static properties of GameScene / Tank in the Swift version) */
export const GameState = {
  /** Easy mode after 3 losses in a row */
  isEasyMode: false,
  /** Secret Gorodets bonus stage: enemy tanks are drawn as painted birds */
  isBirdStage: false,
  /** Gzhel level (friend tank, black cat) */
  isGzhelActive: false,
  /** Alien mode (after a UFO egg): many heavy tanks and the small alien */
  isAlienModeActive: false,
  /** Map of the running game (tanks check for water under them) */
  currentMap: null as GameMap | null,
  /** Touch screen (coarse pointer): on-screen joystick and fire buttons */
  touchControls: false,
};
