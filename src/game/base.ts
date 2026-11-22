import { Action } from "../engine/actions";
import { Colors, darker, rgb, white, type Color } from "../engine/color";
import { randomIn, type Point } from "../engine/geometry";
import { LabelNode, Node, ShapeNode } from "../engine/node";
import { Path } from "../engine/path";
import { C } from "./constants";
import { GameState } from "./state";

/** Who sits at the base */
export type Resident = { kind: "cat" } | { kind: "alien" } | { kind: "woman" } | { kind: "rat" } | { kind: "dog" };

const SKIN = rgb(1.0, 0.84, 0.72);

function shape(path: Path, fill: Color, stroke: Color = Colors.clear, width = 1): ShapeNode {
  const node = new ShapeNode(path);
  node.fillColor = fill;
  node.strokeColor = stroke;
  node.lineWidth = width;
  return node;
}

function ellipse(w: number, h: number, at: Point, fill: Color, stroke: Color = Colors.clear): ShapeNode {
  const node = ShapeNode.ellipse(w, h);
  node.position = { ...at };
  node.fillColor = fill;
  node.strokeColor = stroke;
  node.lineWidth = 1;
  return node;
}

function polygon(points: number[][]): Path {
  const path = new Path();
  points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  return path.close();
}

function line(x1: number, y1: number, x2: number, y2: number): Path {
  return new Path().moveTo(x1, y1).lineTo(x2, y2);
}

/** The base (cat, alien, woman, rat or dog) that players must protect */
export class Base extends Node {
  private isDestroyed = false;
  private readonly baseSize = C.tileSize; // Fits inside the protection walls
  private catNode: Node | null = null;
  private readonly resident: Resident;

  constructor(position: Point, resident: Resident = { kind: "cat" }) {
    super();
    this.resident = resident;
    this.position = { ...position };
    this.zPosition = 5;
    this.drawBase();
  }

  private get isAlien(): boolean {
    return this.resident.kind === "alien";
  }

  private drawBase(): void {
    this.removeAllChildren();
    const size = this.baseSize;

    if (this.isDestroyed) {
      // Destroyed base - sad scene
      const background = ShapeNode.rect(size, size);
      background.fillColor = rgb(0.2, 0.2, 0.2);
      background.strokeColor = Colors.clear;
      this.addChild(background);
      for (let i = 0; i < 5; i++) {
        const piece = ShapeNode.rect(randomIn(4, 8), randomIn(4, 8));
        piece.position = { x: randomIn(-10, 10), y: randomIn(-10, 10) };
        piece.fillColor = rgb(0.4, 0.3, 0.2);
        piece.strokeColor = Colors.clear;
        piece.zRotation = randomIn(0, Math.PI);
        this.addChild(piece);
      }
      return;
    }

    switch (this.resident.kind) {
      case "alien":
        this.drawAlien();
        return;
      case "woman":
        this.drawWoman();
        return;
      case "rat":
        this.drawRat();
        return;
      case "dog":
        this.drawDog();
        return;
      default:
        this.drawCat();
    }
  }

  private drawCat(): void {
    const size = this.baseSize;
    // Cushion is separate so the cat can walk away from it
    const cushion = ShapeNode.ellipse(size * 0.9, size * 0.7);
    cushion.fillColor = rgb(0.8, 0.6, 0.7);
    cushion.strokeColor = rgb(0.6, 0.4, 0.5);
    cushion.lineWidth = 2;
    cushion.position = { x: 0, y: -2 };
    cushion.name = "cushion";
    this.addChild(cushion);

    const cat = new Node();
    this.catNode = cat;

    // Black for Gzhel, white for easy mode, orange tabby otherwise
    let catColor: Color;
    let darkCatColor: Color;
    if (GameState.isGzhelActive) {
      catColor = rgb(0.15, 0.15, 0.18);
      darkCatColor = rgb(0.08, 0.08, 0.1);
    } else if (GameState.isEasyMode) {
      catColor = rgb(0.98, 0.98, 0.98);
      darkCatColor = rgb(0.85, 0.85, 0.85);
    } else {
      catColor = rgb(1.0, 0.6, 0.2);
      darkCatColor = rgb(0.8, 0.4, 0.1);
    }

    cat.addChild(ellipse(18, 14, { x: 0, y: -2 }, catColor, darkCatColor)); // Body
    cat.addChild(ellipse(16, 16, { x: 0, y: 8 }, catColor, darkCatColor)); // Head

    // Ears
    cat.addChild(shape(polygon([[-6, 12], [-10, 20], [-2, 14]]), catColor, darkCatColor));
    cat.addChild(shape(polygon([[6, 12], [10, 20], [2, 14]]), catColor, darkCatColor));
    const innerEar = rgb(1.0, 0.7, 0.8);
    cat.addChild(shape(polygon([[-6, 13], [-8, 18], [-4, 14]]), innerEar));
    cat.addChild(shape(polygon([[6, 13], [8, 18], [4, 14]]), innerEar));

    // Eyes and pupils
    for (const x of [-3, 3]) {
      const eye = ellipse(4, 5, { x, y: 9 }, Colors.green, Colors.black);
      eye.lineWidth = 0.5;
      cat.addChild(eye);
    }
    for (const x of [-3, 3]) cat.addChild(ellipse(2, 3, { x, y: 9 }, Colors.black));

    // Nose
    cat.addChild(shape(polygon([[0, 6], [-2, 4], [2, 4]]), rgb(1.0, 0.5, 0.5)));

    // Whiskers
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const yOffset = (i - 1) * 2;
        cat.addChild(shape(line(side * 3, 5 + yOffset, side * 12, 4 + yOffset + (i - 1)), Colors.clear, Colors.white, 0.5));
      }
    }

    // Stripes on the body (not for the white cat)
    if (!GameState.isEasyMode) {
      for (let i = 0; i < 3; i++) {
        const stripe = ShapeNode.rect(10, 2);
        stripe.fillColor = darkCatColor;
        stripe.strokeColor = Colors.clear;
        stripe.position = { x: 0, y: -2 + (i - 1) * 4 };
        stripe.zRotation = randomIn(-0.2, 0.2);
        cat.addChild(stripe);
      }
    }

    // Curled tail
    const tail = shape(new Path().moveTo(8, -4).quadTo(14, -6, 14, 2).quadTo(18, 4, 12, 8), Colors.clear, catColor, 4);
    tail.lineCap = "round";
    cat.addChild(tail);

    this.addChild(cat);
    // Idle: gentle breathing
    cat.run(Action.repeatForever(Action.sequence([Action.scaleYTo(1.05, 1.5), Action.scaleYTo(0.95, 1.5)])));
  }

  /** Victory: the cat plays with a toy (batting it around) */
  playVictoryAnimation(): void {
    const cat = this.catNode;
    if (!cat || this.isDestroyed) return;
    cat.removeAllActions();
    cat.setScale(1.0);
    cat.position = { x: 25, y: 0 };

    const toy = ShapeNode.circle(5);
    toy.fillColor = Colors.red;
    toy.strokeColor = Colors.yellow;
    toy.lineWidth = 1;
    toy.position = { x: 45, y: -5 };
    toy.zPosition = 2;
    this.addChild(toy);

    const watchLeft = Action.rotateTo(0.15, 0.3);
    const watchRight = Action.rotateTo(-0.15, 0.3);
    const watchCenter = Action.rotateTo(0, 0.2);
    const crouch = Action.scaleYTo(0.8, 0.15);
    const pounce = Action.group([Action.scaleYTo(1.1, 0.1), Action.moveBy(8, 3, 0.1)]);
    const recover = Action.group([Action.scaleYTo(1.0, 0.15), Action.moveBy(-8, -3, 0.15)]);

    let toyGoingRight = true;
    const batToy = Action.run(() => {
      const direction = toyGoingRight ? 1 : -1;
      toyGoingRight = !toyGoingRight;
      const flyAway = Action.moveBy(direction * 35, 8, 0.2).ease("easeOut");
      const rollBack = Action.moveBy(direction * -30, -8, 0.6).ease("easeOut");
      toy.run(Action.group([Action.sequence([flyAway, rollBack]), Action.rotateBy(direction * Math.PI * 3, 0.8)]));
    });

    const playOnce = Action.sequence([
      watchLeft,
      Action.wait(0.3),
      watchCenter,
      crouch,
      Action.wait(0.1),
      pounce,
      batToy,
      recover,
      Action.wait(0.5),
      watchRight,
      Action.wait(0.3),
      watchCenter,
      crouch,
      Action.wait(0.1),
      pounce,
      batToy,
      recover,
      Action.wait(0.5),
    ]);

    cat.run(Action.sequence([Action.moveBy(0, 10, 0.15), Action.moveBy(0, -10, 0.1), Action.wait(0.3), Action.repeatForever(playOnce)]));
  }

  checkCollision(bulletPosition: Point): boolean {
    if (this.isDestroyed) return false;
    const halfSize = this.baseSize / 2;
    return Math.abs(bulletPosition.x - this.position.x) < halfSize && Math.abs(bulletPosition.y - this.position.y) < halfSize;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.drawBase();
    // Orange explosion burst
    for (let i = 0; i < 40; i++) {
      const particle = ShapeNode.circle(randomIn(1, 2.5));
      particle.fillColor = Colors.orange;
      particle.strokeColor = Colors.clear;
      particle.zPosition = 10;
      this.addChild(particle);
      const angle = randomIn(0, Math.PI * 2);
      const speed = randomIn(20, 80) * 0.5;
      particle.run(
        Action.sequence([
          Action.wait(randomIn(0, 0.4)),
          Action.group([Action.moveBy(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.5), Action.fadeOut(0.5)]),
          Action.removeFromParent(),
        ]),
      );
    }
  }

  get alive(): boolean {
    return !this.isDestroyed;
  }

  // MARK: Alien

  private drawAlien(): void {
    const alienGreen = rgb(0.4, 0.9, 0.4);
    const alienDark = rgb(0.2, 0.6, 0.2);

    // Small spaceship pad
    const pad = ellipse(this.baseSize * 0.8, this.baseSize * 0.4, { x: 0, y: -8 }, rgb(0.3, 0.3, 0.4), rgb(0.5, 0.5, 0.6));
    pad.lineWidth = 2;
    pad.name = "pad";
    this.addChild(pad);

    const alien = new Node();
    this.catNode = alien;
    alien.addChild(ellipse(14, 18, { x: 0, y: 0 }, alienGreen, alienDark));
    alien.addChild(ellipse(20, 16, { x: 0, y: 14 }, alienGreen, alienDark));
    alien.addChild(ellipse(8, 10, { x: -5, y: 14 }, Colors.black));
    alien.addChild(ellipse(8, 10, { x: 5, y: 14 }, Colors.black));
    alien.addChild(ellipse(4, 4, { x: -6, y: 16 }, Colors.white));
    alien.addChild(ellipse(4, 4, { x: 4, y: 16 }, Colors.white));

    const smile = shape(new Path().moveTo(-6, 6).quadTo(0, 0, 6, 6), Colors.clear, alienDark, 2);
    smile.lineCap = "round";
    alien.addChild(smile);

    alien.addChild(shape(new Path().moveTo(-6, 20).quadTo(-12, 24, -10, 28), Colors.clear, alienGreen, 2));
    const leftBall = ellipse(6, 6, { x: -10, y: 28 }, Colors.yellow, Colors.orange);
    alien.addChild(leftBall);
    alien.addChild(shape(new Path().moveTo(6, 20).quadTo(12, 24, 10, 28), Colors.clear, alienGreen, 2));
    const rightBall = ellipse(6, 6, { x: 10, y: 28 }, Colors.yellow, Colors.orange);
    alien.addChild(rightBall);

    const leftArm = shape(line(-7, 0, -14, 5), Colors.clear, alienGreen, 3);
    leftArm.lineCap = "round";
    leftArm.name = "leftArm";
    alien.addChild(leftArm);
    const rightArm = shape(line(7, 0, 14, 5), Colors.clear, alienGreen, 3);
    rightArm.lineCap = "round";
    rightArm.name = "rightArm";
    alien.addChild(rightArm);

    this.addChild(alien);

    // Idle: antenna balls glow and arms wave
    const glowUp = Action.fadeAlpha(1.0, 0.5);
    const glowDown = Action.fadeAlpha(0.5, 0.5);
    leftBall.run(Action.repeatForever(Action.sequence([glowUp, glowDown])));
    rightBall.run(Action.repeatForever(Action.sequence([glowDown, glowUp])));
    const waveUp = Action.rotateBy(0.3, 0.3);
    const waveDown = Action.rotateBy(-0.3, 0.3);
    leftArm.run(Action.repeatForever(Action.sequence([waveUp, waveDown])));
    rightArm.run(Action.repeatForever(Action.sequence([waveDown, waveUp])));
  }

  /** Alien victory: a UFO comes and picks up the alien */
  playAlienVictoryAnimation(): void {
    const alien = this.catNode;
    if (!alien || !this.isAlien || this.isDestroyed) return;
    alien.removeAllActions();
    for (const child of alien.children) child.removeAllActions();

    const ufo = new Node();
    ufo.position = { x: 0, y: 150 };
    ufo.name = "rescueUFO";

    const saucer = ellipse(50, 15, { x: 0, y: 0 }, rgb(0.6, 0.6, 0.7), rgb(0.4, 0.4, 0.5));
    saucer.lineWidth = 2;
    ufo.addChild(saucer);
    ufo.addChild(ellipse(25, 18, { x: 0, y: 8 }, rgb(0.5, 0.8, 1.0, 0.7), rgb(0.3, 0.6, 0.8)));

    const lightColors = [Colors.red, Colors.yellow, Colors.green, Colors.cyan, Colors.magenta];
    for (let i = 0; i < 5; i++) {
      const light = ellipse(6, 6, { x: -20 + i * 10, y: -2 }, lightColors[i]);
      ufo.addChild(light);
      light.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(0.3, 0.2), Action.fadeAlpha(1.0, 0.2)])));
    }
    this.addChild(ufo);

    // Tractor beam
    const beam = shape(
      polygon([
        [-15, -5],
        [15, -5],
        [8, -80],
        [-8, -80],
      ]),
      rgb(0.5, 1.0, 0.5, 0.3),
      rgb(0.5, 1.0, 0.5, 0.5),
    );
    beam.alpha = 0;
    ufo.addChild(beam);

    const alienFloatUp = Action.run(() => {
      alien.run(Action.group([Action.moveTo({ x: 0, y: 60 }, 1.5).ease("easeIn"), Action.rotateBy(Math.PI * 2, 1.5), Action.scaleTo(0.3, 1.5)]));
    });

    ufo.run(
      Action.sequence([
        Action.moveToY(60, 1.0).ease("easeOut"),
        Action.run(() => (beam.alpha = 1.0)),
        alienFloatUp,
        Action.wait(1.6),
        Action.run(() => {
          beam.alpha = 0;
          alien.alpha = 0;
        }),
        Action.group([Action.moveToY(200, 1.0).ease("easeIn"), Action.moveToX(100, 1.0).ease("easeIn")]),
        Action.removeFromParent(),
      ]),
    );
  }

  // MARK: Woman and rat (bonus stage) and dog (boss levels)

  /** Purple rug with a gold edge that the woman or the rat sits on */
  private addRug(): void {
    const rug = ellipse(this.baseSize * 0.95, this.baseSize * 0.55, { x: 0, y: -10 }, rgb(0.55, 0.25, 0.6), rgb(0.95, 0.8, 0.3));
    rug.name = "cushion";
    this.addChild(rug);
  }

  /** Woman with black hair in a red polka-dot dress on a rug */
  private drawWoman(): void {
    this.addRug();

    const hair = rgb(0.08, 0.06, 0.06);
    const woman = new Node();
    woman.name = "resident";

    // Long hair behind the head and shoulders
    woman.addChild(shape(new Path().roundRect(-8, -4, 16, 16, 7), hair));
    // Legs
    woman.addChild(shape(new Path().moveTo(-3, -13).lineTo(-3, -17).moveTo(3, -13).lineTo(3, -17), Colors.clear, SKIN, 2));
    // Dress with white dots
    woman.addChild(
      shape(
        polygon([
          [-4.5, -1],
          [4.5, -1],
          [9, -14],
          [-9, -14],
        ]),
        rgb(0.88, 0.1, 0.2),
        rgb(0.55, 0.03, 0.1),
      ),
    );
    for (const [x, y] of [
      [-3, -6],
      [2.5, -4.5],
      [0, -10],
      [-5.5, -11.5],
      [5, -10.5],
    ]) {
      woman.addChild(ellipse(1.6, 1.6, { x, y }, Colors.white));
    }

    // Arms (the right one waves)
    woman.addChild(shape(line(-4.5, -2, -8.5, -8), Colors.clear, SKIN, 2));
    const arm = shape(line(0, 0, 4.5, 5), Colors.clear, SKIN, 2);
    arm.position = { x: 4.5, y: -2 };
    arm.name = "wavingArm";
    woman.addChild(arm);

    // Head, fringe, face
    woman.addChild(ellipse(11, 12, { x: 0, y: 5 }, SKIN));
    woman.addChild(shape(new Path().arc(0, 6.5, 6, 0.15, Math.PI - 0.15, false).close(), hair));
    woman.addChild(ellipse(1.6, 2, { x: -2.2, y: 5 }, Colors.black));
    woman.addChild(ellipse(1.6, 2, { x: 2.2, y: 5 }, Colors.black));
    woman.addChild(ellipse(2, 1.3, { x: -3.6, y: 2.8 }, rgb(1, 0.55, 0.6, 0.8)));
    woman.addChild(ellipse(2, 1.3, { x: 3.6, y: 2.8 }, rgb(1, 0.55, 0.6, 0.8)));
    woman.addChild(ellipse(3.2, 1.6, { x: 0, y: 1.6 }, rgb(0.85, 0.05, 0.15)));

    woman.position = { x: 0, y: 2 };
    this.addChild(woman);
    this.catNode = woman;

    // Idle: a gentle sway and a little wave now and then
    woman.run(Action.repeatForever(Action.sequence([Action.rotateTo(0.05, 1.2), Action.rotateTo(-0.05, 1.2)])));
    arm.run(
      Action.repeatForever(
        Action.sequence([Action.wait(2.0), Action.repeat(Action.sequence([Action.rotateTo(0.6, 0.15), Action.rotateTo(0, 0.15)]), 3)]),
      ),
    );
  }

  /** Grey rat sitting up on the rug (boss bonus stage), twitching its whiskers */
  private drawRat(): void {
    this.addRug();

    const fur = rgb(0.58, 0.58, 0.62);
    const darkFur = rgb(0.35, 0.35, 0.4);
    const lightFur = rgb(0.82, 0.82, 0.85);
    const pink = rgb(1.0, 0.62, 0.7);
    const rat = new Node();
    rat.name = "resident";

    // Long bare tail curling up beside the body
    const tail = shape(new Path().moveTo(4, -12).quadTo(14, -14, 13, -6).quadTo(12, -1, 11, 3), Colors.clear, pink, 1.6);
    tail.lineCap = "round";
    rat.addChild(tail);

    // Body, belly, feet, little front paws
    rat.addChild(ellipse(14, 16, { x: 0, y: -6 }, fur, darkFur));
    rat.addChild(ellipse(8, 10, { x: 0, y: -7 }, lightFur));
    rat.addChild(ellipse(4.5, 2.5, { x: -3.5, y: -14 }, pink));
    rat.addChild(ellipse(4.5, 2.5, { x: 3.5, y: -14 }, pink));
    rat.addChild(ellipse(2.8, 2.6, { x: -2.6, y: -3.5 }, pink));
    rat.addChild(ellipse(2.8, 2.6, { x: 2.6, y: -3.5 }, pink));

    // Big round ears with pink insides
    for (const x of [-6, 6]) {
      rat.addChild(ellipse(8, 8, { x, y: 10 }, fur, darkFur));
      rat.addChild(ellipse(5, 5, { x, y: 10 }, pink));
    }

    // Head, snout, buck teeth, nose, eyes
    rat.addChild(ellipse(12, 11, { x: 0, y: 5 }, fur, darkFur));
    rat.addChild(ellipse(6, 5, { x: 0, y: 1.8 }, lightFur));
    const teeth = ShapeNode.rect(2, 1.6);
    teeth.fillColor = Colors.white;
    teeth.strokeColor = Colors.clear;
    teeth.position = { x: 0, y: -0.4 };
    rat.addChild(teeth);
    rat.addChild(ellipse(2.4, 1.8, { x: 0, y: 1.4 }, rgb(0.95, 0.4, 0.5)));
    for (const x of [-2.4, 2.4]) {
      rat.addChild(ellipse(1.9, 2.3, { x, y: 6.3 }, Colors.black));
      rat.addChild(ellipse(0.7, 0.7, { x: x + 0.4, y: 6.9 }, Colors.white));
    }

    // Whiskers
    const whiskerPath = new Path();
    for (const side of [-1, 1]) {
      whiskerPath.moveTo(side * 2, 1.6).lineTo(side * 8.5, 3.2);
      whiskerPath.moveTo(side * 2, 1.2).lineTo(side * 8.5, 0.2);
    }
    const whiskers = shape(whiskerPath, Colors.clear, rgb(0.15, 0.15, 0.15, 0.8), 0.6);
    rat.addChild(whiskers);

    rat.position = { x: 0, y: 2 };
    this.addChild(rat);
    this.catNode = rat;

    // Idle: a gentle sway, and a quick sniff now and then
    rat.run(Action.repeatForever(Action.sequence([Action.rotateTo(0.05, 1.2), Action.rotateTo(-0.05, 1.2)])));
    whiskers.run(
      Action.repeatForever(
        Action.sequence([Action.wait(1.8), Action.repeat(Action.sequence([Action.moveBy(0, 0.8, 0.07), Action.moveBy(0, -0.8, 0.07)]), 4)]),
      ),
    );
  }

  /** Cheese taken: a pulsing golden ring shows the base can't be destroyed until the level ends */
  makeInvincible(): void {
    if (this.isDestroyed || this.childNode("invincibleGlow")) return;
    const ring = ShapeNode.rect(this.baseSize + 6, this.baseSize + 6, 6);
    ring.fillColor = rgb(1.0, 0.85, 0.2, 0.15);
    ring.strokeColor = rgb(1.0, 0.85, 0.2);
    ring.lineWidth = 2;
    ring.glowWidth = 3;
    ring.zPosition = -1;
    ring.name = "invincibleGlow";
    this.addChild(ring);
    ring.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(0.35, 0.5), Action.fadeAlpha(1.0, 0.5)])));
  }

  /** Dog sitting on a blue bed, wagging its tail */
  private drawDog(): void {
    const bed = ellipse(this.baseSize * 0.9, this.baseSize * 0.65, { x: 0, y: -4 }, rgb(0.3, 0.5, 0.85), rgb(0.15, 0.3, 0.6));
    bed.name = "cushion";
    this.addChild(bed);

    const fur = rgb(0.62, 0.4, 0.2);
    const darkFur = rgb(0.38, 0.22, 0.1);
    const tan = rgb(0.9, 0.75, 0.55);
    const dog = new Node();
    dog.name = "resident";

    const tail = shape(new Path().moveTo(0, 0).quadTo(6, 0, 6, 6), Colors.clear, fur, 3);
    tail.lineCap = "round";
    tail.position = { x: 6, y: -9 };
    tail.name = "tail";
    dog.addChild(tail);

    dog.addChild(ellipse(15, 14, { x: 0, y: -6 }, fur, darkFur));
    dog.addChild(ellipse(7, 8, { x: 0, y: -6 }, tan));
    dog.addChild(ellipse(4, 3, { x: -3, y: -12.5 }, tan, darkFur));
    dog.addChild(ellipse(4, 3, { x: 3, y: -12.5 }, tan, darkFur));

    const collar = ShapeNode.rect(9, 2, 1);
    collar.fillColor = rgb(0.85, 0.1, 0.1);
    collar.strokeColor = Colors.clear;
    collar.position = { x: 0, y: -0.5 };
    dog.addChild(collar);
    dog.addChild(ellipse(2.2, 2.2, { x: 0, y: -2 }, Colors.yellow));

    const leftEar = ellipse(5, 10, { x: -6.5, y: 4 }, darkFur);
    leftEar.zRotation = -0.3;
    dog.addChild(leftEar);
    const rightEar = ellipse(5, 10, { x: 6.5, y: 4 }, darkFur);
    rightEar.zRotation = 0.3;
    dog.addChild(rightEar);
    dog.addChild(ellipse(13, 12, { x: 0, y: 6 }, fur, darkFur));
    dog.addChild(ellipse(8, 6, { x: 0, y: 3 }, tan));
    dog.addChild(ellipse(3.4, 2.4, { x: 0, y: 4.6 }, Colors.black));
    dog.addChild(ellipse(2.4, 3, { x: 0, y: 0.6 }, rgb(1, 0.45, 0.55)));
    dog.addChild(ellipse(2, 2.4, { x: -2.8, y: 8 }, Colors.black));
    dog.addChild(ellipse(2, 2.4, { x: 2.8, y: 8 }, Colors.black));

    dog.position = { x: 0, y: 2 };
    this.addChild(dog);
    this.catNode = dog;

    tail.run(Action.repeatForever(Action.sequence([Action.rotateTo(0.5, 0.18), Action.rotateTo(-0.3, 0.18)])));
  }

  /** Bonus stage cleared: a car drives up, the woman (red car) or the rat (pink car) gets in and they drive off */
  playCarPickupAnimation(pink: boolean): void {
    const woman = this.catNode;
    if (!woman || this.isDestroyed) return;
    woman.removeAllActions();
    woman.zRotation = 0;

    const car = new Node();
    car.zPosition = 30;
    const paint = pink ? rgb(1.0, 0.45, 0.7) : rgb(0.85, 0.08, 0.1);
    car.addChild(shape(new Path().roundRect(-18, -5, 36, 11, 4), paint, darker(paint), 1.5));
    car.addChild(shape(new Path().roundRect(-10, 5, 19, 9, 4), paint, darker(paint), 1.5));
    car.addChild(shape(new Path().roundRect(-8, 6.5, 15, 6, 2), rgb(0.7, 0.9, 1.0)));
    car.addChild(ellipse(3, 3, { x: 17, y: 1 }, Colors.yellow));
    const wheels: Node[] = [];
    for (const x of [-10, 10]) {
      const wheel = new Node();
      wheel.position = { x, y: -6 };
      wheel.addChild(ellipse(9, 9, { x: 0, y: 0 }, white(0.12)));
      const spoke = ShapeNode.rect(7, 1.4);
      spoke.fillColor = white(0.75);
      spoke.strokeColor = Colors.clear;
      wheel.addChild(spoke);
      car.addChild(wheel);
      wheels.push(wheel);
    }
    car.position = { x: -260, y: -2 };
    this.addChild(car);
    for (const wheel of wheels) wheel.run(Action.repeatForever(Action.rotateBy(-Math.PI * 2, 0.35)));

    const honk = Action.run(() => {
      const label = new LabelNode("♥ BEEP BEEP ♥", "Helvetica-Bold");
      label.fontSize = 10;
      label.fontColor = Colors.white;
      label.position = { x: -34, y: 24 };
      label.zPosition = 31;
      this.addChild(label);
      label.run(Action.sequence([Action.moveBy(0, 12, 1.0), Action.fadeOut(0.4), Action.removeFromParent()]));
    });
    const getIn = Action.run(() => {
      woman.run(Action.sequence([Action.moveToX(-30, 0.6), Action.group([Action.scaleTo(0.4, 0.3), Action.fadeOut(0.3)])]));
    });
    car.run(
      Action.sequence([
        Action.moveToX(-34, 1.4).ease("easeOut"),
        honk,
        Action.wait(0.4),
        getIn,
        Action.wait(1.1),
        Action.moveToX(300, 1.8).ease("easeIn"),
        Action.removeFromParent(),
      ]),
    );
  }

  /** Boss level cleared: the dog trots out, lifts a leg at the base and pees, then wags happily */
  playDogPeeAnimation(): void {
    const dog = this.catNode;
    if (!dog || this.isDestroyed) return;
    dog.removeAllActions();

    const walkOut = Action.group([
      Action.moveToX(26, 0.8),
      Action.repeat(Action.sequence([Action.moveBy(0, 2, 0.1), Action.moveBy(0, -2, 0.1)]), 4),
    ]);
    const happy = Action.repeatForever(Action.sequence([Action.moveBy(0, 5, 0.15), Action.moveBy(0, -5, 0.12), Action.wait(0.6)]));
    dog.run(
      Action.sequence([
        Action.moveBy(0, 8, 0.15),
        Action.moveBy(0, -8, 0.12),
        walkOut,
        Action.wait(0.3),
        Action.rotateTo(0.35, 0.25),
        Action.run(() => this.startPeeStream({ x: 19, y: -8 })),
        Action.wait(2.2),
        Action.rotateTo(0, 0.25),
        happy,
      ]),
    );
  }

  /** Yellow drops arcing from the dog toward the base, and a growing puddle */
  private startPeeStream(start: Point): void {
    const puddle = ellipse(4, 2, { x: 9, y: -14 }, rgb(1.0, 0.9, 0.2, 0.85));
    puddle.zPosition = 1;
    this.addChild(puddle);
    puddle.run(Action.scaleXYTo(3.2, 2.4, 2.0));

    const drip = Action.run(() => {
      const drop = ellipse(2, 2, start, rgb(1.0, 0.88, 0.15));
      drop.zPosition = 3;
      this.addChild(drop);
      const end = { x: 9 + randomIn(-2, 2), y: -13 };
      drop.run(Action.sequence([Action.followQuad(start, { x: 13, y: -2 }, end, 0.3), Action.removeFromParent()]));
    });
    this.run(Action.repeat(Action.sequence([drip, Action.wait(0.04)]), 50));
  }
}
