import { View } from "./engine/view";
import { GameScene } from "./game/gameScene";
import { MenuScene } from "./game/menuScene";
import { SoundManager } from "./game/sound";
import { GameState } from "./game/state";

// Touch screens get the on-screen joystick and fire buttons; desktops use the keyboard
GameState.touchControls = window.matchMedia("(pointer: coarse)").matches;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const view = new View(canvas);

// Browsers only allow sound after a user gesture
const unlock = () => SoundManager.unlock();
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

// Desktop overlay: score at the top left and a pause button (like the Mac version)
const hud = document.getElementById("hud")!;
const scoreElement = document.getElementById("score")!;
const pauseButton = document.getElementById("pause") as HTMLButtonElement;
GameScene.hudListener = (info) => {
  hud.classList.toggle("visible", info !== null);
  if (!info) return;
  if (scoreElement.textContent !== info.text) scoreElement.textContent = info.text;
  scoreElement.classList.toggle("plate", info.plate);
};
pauseButton.addEventListener("click", () => {
  if (view.scene instanceof GameScene) view.scene.requestPause();
  pauseButton.blur(); // Keep Space / Enter for the game
});

view.present(new MenuScene(view.preferredSceneSize));
