import { Action } from "../engine/actions";
import { Colors, rgb, type Color } from "../engine/color";
import { randomElement, randomIn, randomInt, type Point, type Size } from "../engine/geometry";
import { Node, ShapeNode } from "../engine/node";
import { Bullet } from "./bullet";
import { C } from "./constants";
import { Direction } from "./direction";

const UFO_SIZE = 48;

/** How the UFO gets around: a new style every time one shows up */
type FlightStyle = "cruise" | "wave" | "zigzag" | "hover";

/** UFO that flies across the screen and drops easter eggs when destroyed */
export class UFO extends Node {
  private readonly style: FlightStyle;
  private readonly flySpeed: number;
  private readonly mapSize: Size;
  /** Points to fly through; the last one is off the map (where it escapes) */
  private waypoints: Point[] = [];
  private pauseTimer = 0;
  private wavePhase = 0;
  private health = 3;
  private lifetime = C.ufoLifetime;
  private shootCooldown = C.ufoShootCooldown;
  private leaving = false;

  private readonly bodyNode: ShapeNode;
  private readonly domeNode: ShapeNode;
  private readonly lightsNode = new Node();
  private lightFrame = 0;

  isAlive = true;

  /** Comes in from a random side (left, right or top) and leaves through a random side */
  constructor(mapSize: Size) {
    super();
    this.mapSize = mapSize;
    this.style = randomElement<FlightStyle>(["cruise", "wave", "zigzag", "hover"])!;
    this.flySpeed = randomIn(1.2, 2.2);

    this.bodyNode = ShapeNode.ellipse(UFO_SIZE, UFO_SIZE * 0.4);
    this.bodyNode.fillColor = rgb(0.47, 0.47, 0.55);
    this.bodyNode.strokeColor = rgb(0.31, 0.31, 0.39);
    this.bodyNode.lineWidth = 2;
    this.bodyNode.position = { x: 0, y: -UFO_SIZE * 0.1 };

    this.domeNode = ShapeNode.ellipse(UFO_SIZE * 0.5, UFO_SIZE * 0.5);
    this.domeNode.fillColor = rgb(0.59, 0.78, 1.0, 0.7);
    this.domeNode.strokeColor = Colors.clear;
    this.domeNode.position = { x: 0, y: UFO_SIZE * 0.15 };

    this.position = UFO.offMapPoint(mapSize, randomInt(0, 2));
    this.zPosition = 100;
    this.planRoute();

    this.addChild(this.bodyNode);
    this.addChild(this.domeNode);
    this.addChild(this.lightsNode);

    const highlight = ShapeNode.ellipse(UFO_SIZE * 0.2, UFO_SIZE * 0.2);
    highlight.fillColor = rgb(0.78, 0.9, 1.0, 0.5);
    highlight.strokeColor = Colors.clear;
    highlight.position = { x: -UFO_SIZE * 0.1, y: UFO_SIZE * 0.25 };
    this.addChild(highlight);

    this.createLights();
    this.updateHealthIndicator();

    // Hover bob (on the children so the flight position stays exact)
    for (const child of [this.bodyNode, this.domeNode, this.lightsNode, highlight]) {
      child.run(Action.repeatForever(Action.sequence([Action.moveBy(0, 3, 0.3), Action.moveBy(0, -3, 0.3)])));
    }
  }

  private createLights(): void {
    this.lightsNode.removeAllChildren();
    const colors: Color[] = [Colors.red, Colors.yellow, Colors.green, Colors.cyan];
    for (let i = 0; i < 4; i++) {
      const light = ShapeNode.circle(3);
      light.fillColor = colors[(this.lightFrame + i) % 4];
      light.strokeColor = Colors.clear;
      const angle = (i * Math.PI) / 2;
      const radius = UFO_SIZE * 0.35;
      light.position = { x: Math.cos(angle) * radius, y: Math.sin(angle) * UFO_SIZE * 0.1 - UFO_SIZE * 0.1 };
      this.lightsNode.addChild(light);
    }
  }

  /** A point just outside the map: 0 = left, 1 = right, 2 = top, 3 = bottom */
  private static offMapPoint(mapSize: Size, edge: number): Point {
    const margin = UFO_SIZE + 10;
    switch (edge) {
      case 0:
        return { x: -margin, y: randomIn(120, mapSize.height - 80) };
      case 1:
        return { x: mapSize.width + margin, y: randomIn(120, mapSize.height - 80) };
      case 2:
        return { x: randomIn(80, mapSize.width - 80), y: mapSize.height + margin };
      default:
        return { x: randomIn(80, mapSize.width - 80), y: -margin };
    }
  }

  /** Random point over the battlefield (anywhere from just above the base to the top) */
  private randomFieldPoint(): Point {
    return { x: randomIn(60, this.mapSize.width - 60), y: randomIn(110, this.mapSize.height - 60) };
  }

  private planRoute(): void {
    this.waypoints = [];
    switch (this.style) {
      case "cruise":
      case "wave": {
        const n = randomInt(2, 3);
        for (let i = 0; i < n; i++) this.waypoints.push(this.randomFieldPoint());
        break;
      }
      case "zigzag": {
        let point = this.randomFieldPoint();
        this.waypoints.push(point);
        const n = randomInt(5, 8);
        for (let i = 0; i < n; i++) {
          point = {
            x: Math.min(Math.max(point.x + randomIn(-220, 220), 60), this.mapSize.width - 60),
            y: Math.min(Math.max(point.y + randomIn(-180, 180), 110), this.mapSize.height - 60),
          };
          this.waypoints.push(point);
        }
        break;
      }
      case "hover": {
        const n = randomInt(2, 4);
        for (let i = 0; i < n; i++) this.waypoints.push(this.randomFieldPoint());
        break;
      }
    }
    // Escape through any side except the bottom (the base is there)
    this.waypoints.push(UFO.offMapPoint(this.mapSize, randomInt(0, 2)));
  }

  /** Time is up: skip the remaining points and head for the exit */
  private leaveNow(): void {
    const exit = this.waypoints[this.waypoints.length - 1];
    if (this.leaving || !exit) return;
    this.leaving = true;
    this.pauseTimer = 0;
    this.waypoints = [exit];
  }

  private updateHealthIndicator(): void {
    for (const child of this.children.filter((c) => c.name === "health")) child.removeFromParent();
    for (let i = 0; i < this.health; i++) {
      const dot = ShapeNode.circle(3);
      dot.fillColor = Colors.green;
      dot.strokeColor = Colors.clear;
      dot.position = { x: (i - 1) * 8, y: UFO_SIZE * 0.4 };
      dot.name = "health";
      this.addChild(dot);
    }
  }

  update(): Bullet[] {
    if (!this.isAlive) return [];
    const newBullets: Bullet[] = [];

    // Time is up: head straight for the exit (never vanishes in the middle of the map)
    this.lifetime -= 1;
    if (this.lifetime <= 0) this.leaveNow();

    if (this.pauseTimer > 0) {
      this.pauseTimer -= 1; // Hanging over a spot
    } else if (this.waypoints.length) {
      const target = this.waypoints[0];
      const dx = target.x - this.position.x;
      const dy = target.y - this.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= this.flySpeed * 2 + 4) {
        this.waypoints.shift();
        if (!this.waypoints.length) {
          this.isAlive = false; // Flew off the map: escaped
          return [];
        }
        if (this.style === "hover" && !this.leaving) this.pauseTimer = randomInt(50, 120);
      } else {
        let vx = (dx / distance) * this.flySpeed;
        let vy = (dy / distance) * this.flySpeed;
        if (this.style === "wave") {
          // Sideways swing across the direction of travel
          this.wavePhase += 0.06;
          const swing = Math.cos(this.wavePhase) * 1.6;
          vx += (-dy / distance) * swing;
          vy += (dx / distance) * swing;
        }
        this.position.x += vx;
        this.position.y += vy;
      }
    }

    this.shootCooldown -= 1;
    if (this.shootCooldown <= 0) {
      newBullets.push(new Bullet(this.position.x, this.position.y - UFO_SIZE / 2, Direction.Down, null, { isEnemy: true }));
      this.shootCooldown = C.ufoShootCooldown + randomInt(0, 29);
    }

    this.lightFrame = (this.lightFrame + 1) % 8;
    if (this.lightFrame % 2 === 0) this.createLights();

    return newBullets;
  }

  /** Returns true when destroyed */
  damage(): boolean {
    this.health -= 1;
    this.updateHealthIndicator();

    // Flash
    const body = this.bodyNode;
    const normal = body.fillColor;
    body.run(
      Action.sequence([Action.run(() => (body.fillColor = Colors.white)), Action.wait(0.1), Action.run(() => (body.fillColor = normal))]),
      "flash",
    );

    if (this.health <= 0) {
      this.isAlive = false;
      return true;
    }
    return false;
  }

  collidesWith(bullet: Bullet): boolean {
    if (!this.isAlive || bullet.isEnemy || bullet.isFromGzhel) return false; // Player bullets only
    const bs = C.bulletSize;
    const halfSize = UFO_SIZE / 2;
    return Math.abs(bullet.position.x - this.position.x) < halfSize + bs / 2 && Math.abs(bullet.position.y - this.position.y) < halfSize + bs / 2;
  }

  createDestroyEffect(): void {
    const parent = this.parent;
    if (!parent) return;
    const colors: Color[] = [Colors.red, Colors.orange, Colors.yellow, Colors.cyan];
    for (let i = 0; i < 20; i++) {
      const particle = ShapeNode.circle(randomIn(2, 6));
      particle.fillColor = colors[randomInt(0, 3)];
      particle.strokeColor = Colors.clear;
      particle.position = { ...this.position };
      particle.zPosition = 150;
      parent.addChild(particle);
      particle.run(Action.sequence([Action.group([Action.moveBy(randomIn(-50, 50), randomIn(-50, 50), 0.5), Action.fadeOut(0.5)]), Action.removeFromParent()]));
    }
  }
}
