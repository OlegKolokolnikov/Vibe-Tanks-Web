import { Action } from "../engine/actions";
import { Colors, css, rgb, type Color } from "../engine/color";
import { CustomNode, LabelNode, Node, ShapeNode } from "../engine/node";
import { C } from "./constants";
import type { Tank } from "./tank";

const EGG_SIZE = 32;
const RAINBOW: Color[] = [Colors.red, Colors.orange, Colors.yellow, Colors.green, Colors.blue, Colors.purple];

/**
 * Easter egg that spawns when the UFO is destroyed.
 * Player collects it: all enemies become POWER tanks, the player gets 3 lives.
 * An enemy collects it: all enemies become HEAVY tanks.
 */
export class EasterEgg extends Node {
  private lifetime = C.easterEggLifetime;
  private collected = false;
  private readonly eggNode = new Node();
  private colorOffset = 0;
  private stripeOffset = 0;

  get isExpired(): boolean {
    return this.lifetime <= 0 || this.collected;
  }

  get isCollected(): boolean {
    return this.collected;
  }

  constructor(x: number, y: number) {
    super();
    this.position = { x, y };
    this.zPosition = 50;
    this.addChild(this.eggNode);
    this.drawEgg();

    // Pulsing glow
    const glow = ShapeNode.ellipse(EGG_SIZE + 8, EGG_SIZE + 8);
    glow.fillColor = rgb(1, 1, 0.4, 0.3);
    glow.strokeColor = Colors.clear;
    glow.zPosition = -1;
    glow.name = "glow";
    this.addChild(glow);
    glow.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(0.6, 0.3), Action.fadeAlpha(0.3, 0.3)])));

    // Float
    this.eggNode.run(Action.repeatForever(Action.sequence([Action.moveBy(0, 4, 0.5), Action.moveBy(0, -4, 0.5)])));
  }

  private drawEgg(): void {
    const eggWidth = EGG_SIZE * 0.7;
    const eggHeight = EGG_SIZE * 0.9;

    const eggShape = ShapeNode.ellipse(eggWidth, eggHeight);
    eggShape.fillColor = rgb(1.0, 0.98, 0.86); // Cream
    eggShape.strokeColor = rgb(0.78, 0.71, 0.39); // Gold outline
    eggShape.lineWidth = 2;
    this.eggNode.addChild(eggShape);

    // Rainbow stripes clipped to the egg shape
    const stripeHeight = eggHeight / 6;
    const stripes = new CustomNode((ctx) => {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, (eggWidth - 4) / 2, (eggHeight - 4) / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.7;
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = css(RAINBOW[(i + this.stripeOffset) % 6]);
        const cy = eggHeight / 2 - stripeHeight / 2 - i * stripeHeight;
        ctx.fillRect(-(eggWidth - 4) / 2, cy - (stripeHeight + 1) / 2, eggWidth - 4, stripeHeight + 1);
      }
      ctx.restore();
    });
    stripes.name = "stripes";
    this.eggNode.addChild(stripes);

    const sparkle = ShapeNode.ellipse(6, 4);
    sparkle.fillColor = Colors.white;
    sparkle.strokeColor = Colors.clear;
    sparkle.position = { x: -eggWidth * 0.2, y: eggHeight * 0.25 };
    sparkle.alpha = 0.8;
    sparkle.name = "sparkle";
    this.eggNode.addChild(sparkle);
    sparkle.run(Action.repeatForever(Action.sequence([Action.fadeAlpha(1, 0.2), Action.fadeAlpha(0.3, 0.2)])));
  }

  update(): void {
    this.lifetime -= 1;
    // Rainbow colors shift
    this.colorOffset += 1;
    if (this.colorOffset % 12 === 0) this.stripeOffset = Math.floor(this.colorOffset / 12) % 6;
    // Blink when about to expire
    this.alpha = this.lifetime < 120 && this.lifetime % 10 < 5 ? 0.5 : 1;
  }

  collidesWith(tank: Tank): boolean {
    const dx = Math.abs(this.position.x - tank.position.x);
    const dy = Math.abs(this.position.y - tank.position.y);
    const combinedHalfSize = (EGG_SIZE + tank.tankSize) / 2;
    return dx < combinedHalfSize && dy < combinedHalfSize;
  }

  collect(): void {
    this.collected = true;
    const parent = this.parent;
    if (!parent) return;

    // Rainbow particles burst
    for (let i = 0; i < 18; i++) {
      const particle = ShapeNode.ellipse(8, 12);
      particle.fillColor = RAINBOW[i % 6];
      particle.strokeColor = Colors.white;
      particle.lineWidth = 1;
      particle.position = { ...this.position };
      particle.zPosition = 200;
      parent.addChild(particle);
      const angle = (i * Math.PI * 2) / 18;
      particle.run(
        Action.sequence([
          Action.group([Action.moveBy(Math.cos(angle) * 50, Math.sin(angle) * 50, 0.6), Action.rotateBy(Math.PI * 2, 0.6), Action.fadeOut(0.6)]),
          Action.removeFromParent(),
        ]),
      );
    }

    // Sparkle stars
    for (let i = 0; i < 8; i++) {
      const star = new LabelNode("★");
      star.fontSize = 14;
      star.fontColor = Colors.yellow;
      star.position = { ...this.position };
      star.zPosition = 201;
      parent.addChild(star);
      const angle = (i * Math.PI * 2) / 8 + Math.PI / 8;
      star.run(
        Action.sequence([
          Action.group([Action.moveBy(Math.cos(angle) * 35, Math.sin(angle) * 35, 0.4), Action.scaleTo(1.5, 0.2)]),
          Action.scaleTo(0, 0.2),
          Action.removeFromParent(),
        ]),
      );
    }

    this.removeFromParent();
  }
}
