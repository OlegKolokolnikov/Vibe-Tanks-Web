# Vibe Tanks (Web)

TypeScript + HTML5 Canvas port of the Vibe Tanks iOS / Mac Catalyst game (SpriteKit).
It runs in any modern browser: keyboard on desktop, on-screen joystick and fire buttons on touch screens.

## Run

```sh
npm install
npm run dev       # dev server with hot reload
npm run build     # typecheck + production build into dist/
npm run preview   # serve the production build
```

`dist/` is a static site (relative paths), so it can be hosted anywhere or opened from a local web server.

## Controls

- **Desktop:** player 1 uses WASD + Space, player 2 uses the arrow keys + Enter. Keys can be changed in Options → Controls.
  P or Esc pauses. Enter skips the game over screen and continues. In the menu, Enter / Space / 1 starts one player and 2 starts two players.
- **Touch:** a joystick and a FIRE button. In two-player games each player gets one edge of the screen.
  Options set which side the fire button is on, and Options → Controls sets where it sits for each player.

Settings, keys, tank colors, volume and the high score are saved in `localStorage`.

## Layout

```
src/engine/   Small SpriteKit-like engine: nodes, shapes, labels, sprites, actions, scenes, the view (fixed 60 Hz step)
src/game/     The game, ported file by file from the Swift sources
  gameScene.ts        Game loop, collisions, power-ups, boss, friend, UFO, HUD, end screens
  map.ts              Seeded level generator and tile map
  tank.ts tankAI.ts   Tanks and enemy / friend AI
  borders.ts          Gzhel, Gorodets and Khokhloma border decorations
  menuScene.ts optionsScene.ts controlsScene.ts
src/main.ts   Canvas setup, sound unlock, desktop score / pause overlay
public/       Sounds and icon
```

Two differences from the iOS version come from the browser:

- Sound starts after the first click or key press, because browsers block audio until then.
- Touch controls appear only on devices whose main pointer is coarse (phones and tablets).
