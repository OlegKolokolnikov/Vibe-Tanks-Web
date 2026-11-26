import { Action } from "../engine/actions";
import { Colors, rgb, white, withAlpha } from "../engine/color";
import { randomElement, randomIn, randomInt, type Point } from "../engine/geometry";
import { Node, ShapeNode } from "../engine/node";
import { Path } from "../engine/path";
import type { Bullet } from "./bullet";
import { C } from "./constants";
import { Tile, type GameMap } from "./map";
import type { Tank } from "./tank";

const MAX_EYES = 3;

function near(a: Point, b: Point, distance: number): boolean {
  return Math.abs(a.x - b.x) < distance && Math.abs(a.y - b.y) < distance;
}

/**
 * Alien levels: on random empty (black) tiles, eyes open and close (red alien)
 * or small stars twinkle (green alien). Pure decoration: they block nothing, and a player's
 * bullet makes one go away at once (the bullet flies on). At most three at a time;
 * one eye per level may be red, stars come in white, yellow, red and blue.
 */
export class AlienEyes extends Node {
  private eyes: AlienDecoration[] = [];
  private spawnTimer = randomInt(60, 600);
  private redEyeUsed = false;

  /** stars: stars instead of eyes (green alien) */
  constructor(private readonly stars = false) {
    super();
    this.zPosition = 1; // Under tanks (10), bullets (5) and forest (15)
  }

  /** Called once per game frame */
  update(map: GameMap, tanks: Tank[], playerBullets: Bullet[]): void {
    this.eyes = this.eyes.filter((e) => e.parent !== null);

    // A player's bullet over an open eye shuts it
    const half = C.tileSize * 0.45;
    for (const eye of this.eyes) {
      if (eye.isClosing) continue;
      if (playerBullets.some((b) => near(b.position, eye.position, half))) eye.close(true);
    }

    this.spawnTimer -= 1;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = randomInt(60, 600); // Next one in 1-10 seconds
    if (this.eyes.length >= MAX_EYES) return;
    const spot = this.randomSpot(map, tanks);
    if (!spot) return;

    let eye: AlienDecoration;
    if (this.stars) {
      eye = new AlienStar();
    } else {
      // One red eye per level at most, at a random moment
      const red = !this.redEyeUsed && randomInt(1, 4) === 1;
      if (red) this.redEyeUsed = true;
      eye = new AlienEye(red);
    }
    eye.position = spot;
    this.addChild(eye);
    this.eyes.push(eye);
    eye.open();
  }

  /** A random empty tile away from tanks, other eyes and the base */
  private randomSpot(map: GameMap, tanks: Tank[]): Point | null {
    const ts = C.tileSize;
    const spots: Point[] = [];
    for (let row = 0; row < C.mapHeight; row++) {
      for (let col = 0; col < C.mapWidth; col++) {
        // Base and its protection walls (rows 23-24, cols 12-14)
        if (row >= 23 && col >= 11 && col <= 15) continue;
        const p = { x: col * ts + ts / 2, y: (C.mapHeight - 1 - row) * ts + ts / 2 };
        if (map.getTile(p) !== Tile.Empty) continue;
        if (tanks.some((t) => t.isAlive && near(t.position, p, ts * 1.5))) continue;
        if (this.eyes.some((e) => near(e.position, p, ts * 2))) continue;
        spots.push(p);
      }
    }
    return randomElement(spots) ?? null;
  }
}

/** One eye or star: appears, lives a few seconds, goes away (at once when shot) */
abstract class AlienDecoration extends Node {
  isClosing = false;
  abstract open(): void;
  abstract close(fast: boolean): void;
}

/** A small star: pops up, twinkles, fades out */
class AlienStar extends AlienDecoration {
  private readonly star: ShapeNode;

  constructor() {
    super();
    const outer = C.tileSize * randomIn(0.18, 0.28);
    const inner = outer * 0.4;
    const path = new Path();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const angle = (i * Math.PI) / 5 + Math.PI / 2;
      if (i === 0) path.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else path.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    path.close();
    this.star = new ShapeNode(path);
    const color = randomElement([Colors.white, rgb(1, 0.9, 0.2), rgb(1, 0.25, 0.25), rgb(0.35, 0.6, 1)])!;
    this.star.fillColor = color;
    this.star.strokeColor = withAlpha(color, 0.5);
    this.star.lineWidth = 1;
    this.star.glowWidth = 1.5;
    this.star.setScale(0.01);
    this.star.zRotation = randomIn(0, (2 * Math.PI) / 5);
    this.addChild(this.star);
  }

  open(): void {
    const life = randomIn(2, 6);
    const twinkle = Action.repeatForever(Action.sequence([
      Action.group([Action.scaleTo(0.6, 0.35), Action.fadeAlpha(0.55, 0.35)]),
      Action.group([Action.scaleTo(1, 0.35), Action.fadeAlpha(1, 0.35)]),
    ]));
    this.star.run(Action.repeatForever(Action.rotateBy(Math.PI / 3, 1)), "spin");
    this.star.run(Action.sequence([
      Action.scaleTo(1, 0.3).ease("easeOut"),
      Action.run(() => this.star.run(twinkle, "twinkle")),
      Action.wait(life),
      Action.run(() => this.close(false)),
    ]), "life");
  }

  close(fast: boolean): void {
    if (this.isClosing) return;
    this.isClosing = true;
    this.star.removeAction("life");
    this.star.removeAction("twinkle");
    const t = fast ? 0.08 : 0.4;
    this.star.run(Action.sequence([
      Action.group([Action.scaleTo(0.01, t), Action.fadeAlpha(0, t)]),
      Action.run(() => this.removeFromParent()),
    ]));
  }
}

/** One eye: opens, looks around, blinks maybe, closes and goes away */
class AlienEye extends AlienDecoration {
  private readonly lid = new Node(); // Scaled vertically to open/close the eye
  private readonly pupil: ShapeNode;

  constructor(red: boolean) {
    super();
    const w = C.tileSize * 0.8;
    const h = C.tileSize * 0.5;
    const eyeWhite = ShapeNode.ellipse(w, h);
    eyeWhite.fillColor = red ? rgb(0.9, 0.1, 0.1) : white(0.95);
    eyeWhite.strokeColor = Colors.clear;

    this.pupil = ShapeNode.circle(h * 0.32);
    this.pupil.fillColor = Colors.black;
    this.pupil.strokeColor = Colors.clear;
    const shine = ShapeNode.circle(h * 0.08);
    shine.fillColor = white(1, 0.8);
    shine.strokeColor = Colors.clear;
    shine.position = { x: h * 0.1, y: h * 0.1 };
    this.pupil.addChild(shine);

    this.lid.addChild(eyeWhite);
    this.lid.addChild(this.pupil);
    this.lid.yScale = 0.01;
    this.addChild(this.lid);
  }

  open(): void {
    const openTime = randomIn(2, 6);
    const actions: Action[] = [Action.scaleYTo(1, 0.3).ease("easeOut")];

    // Glance around while open, with a blink now and then
    let elapsed = 0;
    while (elapsed < openTime) {
      const step = randomIn(0.5, 1.4);
      const target = { x: randomIn(-5, 5), y: randomIn(-2, 2) };
      actions.push(Action.run(() => this.pupil.run(Action.moveTo(target, 0.15))));
      if (randomInt(1, 4) === 1) {
        actions.push(Action.sequence([Action.scaleYTo(0.05, 0.08), Action.scaleYTo(1, 0.1)]));
      }
      actions.push(Action.wait(step));
      elapsed += step;
    }
    actions.push(Action.run(() => this.close(false)));
    this.lid.run(Action.sequence(actions), "life");
  }

  close(fast: boolean): void {
    if (this.isClosing) return;
    this.isClosing = true;
    this.lid.removeAction("life");
    this.lid.run(Action.sequence([
      Action.scaleYTo(0.01, fast ? 0.06 : 0.3).ease("easeIn"),
      Action.run(() => this.removeFromParent()),
    ]));
  }
}
