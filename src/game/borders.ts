import { Colors, css, rgb, white, type Color } from "../engine/color";
import { fill, fillEllipse, stroke, strokeEllipse } from "../engine/draw";
import { Node, ShapeNode, SpriteNode, makeTexture, type Texture } from "../engine/node";
import { Path } from "../engine/path";
import { C } from "./constants";

/** Decorative borders around the battlefield (Russian folk painting styles). Textures are drawn y-down. */

const MAP_WIDTH = C.mapWidth * C.tileSize;
const MAP_HEIGHT = C.mapHeight * C.tileSize;
const TOTAL_WIDTH = MAP_WIDTH + C.sidebarWidth;

function stride(from: number, to: number, by: number): number[] {
  const values: number[] = [];
  for (let v = from; v < to; v += by) values.push(v);
  return values;
}

/** Four solid strips around the map */
function addGround(layer: Node, color: Color): void {
  for (const [w, h, x, y] of [
    [200, MAP_HEIGHT + 400, -100, MAP_HEIGHT / 2],
    [200, MAP_HEIGHT + 400, TOTAL_WIDTH + 100, MAP_HEIGHT / 2],
    [TOTAL_WIDTH + 400, 200, TOTAL_WIDTH / 2, MAP_HEIGHT + 100],
    [TOTAL_WIDTH + 400, 200, TOTAL_WIDTH / 2, -100],
  ]) {
    const sprite = new SpriteNode(null, color, { width: w, height: h });
    sprite.position = { x, y };
    layer.addChild(sprite);
  }
}

function place(layer: Node, texture: Texture, x: number, y: number, options: { rotation?: number; flip?: boolean; z?: number } = {}): void {
  const sprite = new SpriteNode(texture);
  sprite.position = { x, y };
  sprite.zRotation = options.rotation ?? 0;
  if (options.flip) sprite.xScale = -1;
  sprite.zPosition = options.z ?? 1;
  layer.addChild(sprite);
}

function frame(layer: Node, inset: number, color: Color, width: number): void {
  const node = new ShapeNode(new Path().roundRect(-inset, -inset, TOTAL_WIDTH + inset * 2, MAP_HEIGHT + inset * 2, 4));
  node.strokeColor = color;
  node.lineWidth = width;
  node.fillColor = Colors.clear;
  node.zPosition = 1;
  layer.addChild(node);
}

// MARK: - Gzhel (reward for the cat victory)

/** Gzhel chamomile: white petals, yellow center, blue accents */
function gzhelFlowerTexture(size: number, blue: Color, lightBlue: Color): Texture {
  const ts = size * 2;
  return makeTexture(ts, ts, (ctx) => {
    const cx = ts / 2;
    const cy = ts / 2;
    const petalWhite = Colors.white;
    const petalShadow = rgb(0.9, 0.92, 0.98);

    // Outer decorative swirls
    stroke(ctx, lightBlue, 1.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + Math.PI / 8;
      const startR = size * 0.7;
      const endR = size * 0.85;
      ctx.moveTo(cx + Math.cos(angle) * startR, cy + Math.sin(angle) * startR);
      ctx.quadraticCurveTo(
        cx + Math.cos(angle + 0.15) * (endR + 5),
        cy + Math.sin(angle + 0.15) * (endR + 5),
        cx + Math.cos(angle + 0.3) * endR,
        cy + Math.sin(angle + 0.3) * endR,
      );
    }
    ctx.stroke();

    // Many thin petals
    const petalCount = 16;
    for (let i = 0; i < petalCount; i++) {
      const angle = (i * Math.PI * 2) / petalCount;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const petalLength = size * 0.55;
      const petalWidth = size * 0.12;
      const petal = new Path2D();
      petal.moveTo(0, size * 0.15);
      petal.quadraticCurveTo(petalWidth, size * 0.15 + petalLength * 0.5, 0, size * 0.15 + petalLength);
      petal.quadraticCurveTo(-petalWidth, size * 0.15 + petalLength * 0.5, 0, size * 0.15);
      fill(ctx, i % 2 === 0 ? petalWhite : petalShadow);
      ctx.fill(petal);
      stroke(ctx, blue, 0.8);
      ctx.stroke(petal);
      stroke(ctx, lightBlue, 0.5);
      ctx.beginPath();
      ctx.moveTo(0, size * 0.18);
      ctx.lineTo(0, size * 0.15 + petalLength * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    // Yellow center, orange ring, dots, blue outline
    const centerRadius = size * 0.18;
    fill(ctx, rgb(1.0, 0.85, 0.2));
    fillEllipse(ctx, cx - centerRadius, cy - centerRadius, centerRadius * 2, centerRadius * 2);
    const innerRadius = size * 0.12;
    fill(ctx, rgb(0.95, 0.7, 0.1));
    fillEllipse(ctx, cx - innerRadius, cy - innerRadius, innerRadius * 2, innerRadius * 2);
    fill(ctx, rgb(0.85, 0.6, 0.1));
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const dotR = size * 0.06;
      fillEllipse(ctx, cx + Math.cos(angle) * dotR - 1, cy + Math.sin(angle) * dotR - 1, 2, 2);
    }
    stroke(ctx, blue, 1.5);
    strokeEllipse(ctx, cx - centerRadius, cy - centerRadius, centerRadius * 2, centerRadius * 2);
  });
}

/** Decorative Gzhel vine with curls and leaves */
function gzhelVineTexture(length: number, color: Color): Texture {
  const w = 50;
  const h = length + 20;
  return makeTexture(w, h, (ctx) => {
    const centerX = 20;
    const startY = 10;
    const endY = h - 10;
    const lightBlue = rgb(0.4, 0.6, 0.9);

    stroke(ctx, color, 2.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centerX, startY);
    ctx.bezierCurveTo(centerX + 15, startY + length * 0.1, centerX - 5, startY + length * 0.25, centerX + 8, startY + length * 0.33);
    ctx.bezierCurveTo(centerX + 20, startY + length * 0.5, centerX - 10, startY + length * 0.8, centerX, endY);
    ctx.stroke();

    stroke(ctx, lightBlue, 1.5);
    ctx.beginPath();
    ctx.moveTo(centerX + 5, startY + length * 0.15);
    ctx.quadraticCurveTo(centerX + 20, startY + length * 0.18, centerX + 18, startY + length * 0.08);
    ctx.quadraticCurveTo(centerX + 22, startY + length * 0.05, centerX + 22, startY + length * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + 10, startY + length * 0.45);
    ctx.quadraticCurveTo(centerX + 22, startY + length * 0.4, centerX + 25, startY + length * 0.5);
    ctx.quadraticCurveTo(centerX + 30, startY + length * 0.52, centerX + 20, startY + length * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - 3, startY + length * 0.75);
    ctx.quadraticCurveTo(centerX - 15, startY + length * 0.78, centerX - 12, startY + length * 0.7);
    ctx.stroke();

    const leaf = (x: number, y: number, angle: number, leafSize: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(leafSize * 0.5, leafSize * 0.5, 0, leafSize);
      ctx.quadraticCurveTo(-leafSize * 0.5, leafSize * 0.5, 0, 0);
      fill(ctx, color);
      ctx.fill();
      stroke(ctx, lightBlue, 0.8);
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, leafSize * 0.7);
      ctx.stroke();
      ctx.restore();
    };
    leaf(centerX + 3, startY + length * 0.25, Math.PI / 4, 12);
    leaf(centerX + 12, startY + length * 0.4, Math.PI / 3, 10);
    leaf(centerX + 5, startY + length * 0.6, -Math.PI / 5, 11);
    leaf(centerX - 5, startY + length * 0.8, -Math.PI / 3, 9);

    fill(ctx, lightBlue);
    for (const [x, y] of [
      [centerX + 15, startY + length * 0.2],
      [centerX + 20, startY + length * 0.35],
      [centerX - 8, startY + length * 0.65],
      [centerX + 8, startY + length * 0.85],
    ]) {
      fillEllipse(ctx, x - 1.5, y - 1.5, 3, 3);
    }
  });
}

export function makeGzhelBorder(): Node {
  const layer = new Node();
  layer.zPosition = -10; // Behind everything
  const blue = rgb(0.0, 0.3, 0.7);
  const lightBlue = rgb(0.4, 0.6, 0.9);
  const flower30 = gzhelFlowerTexture(30, blue, lightBlue);
  const flower25 = gzhelFlowerTexture(25, blue, lightBlue);
  const vine = gzhelVineTexture(50, blue);

  addGround(layer, Colors.white);
  const spacing = 80;
  for (const y of stride(40, MAP_HEIGHT, spacing)) {
    place(layer, flower30, -30, y);
    place(layer, flower30, TOTAL_WIDTH + 30, y, { flip: true });
  }
  for (const x of stride(40, TOTAL_WIDTH, spacing)) {
    place(layer, flower25, x, MAP_HEIGHT + 30, { rotation: -Math.PI / 2 });
    place(layer, flower25, x, -30, { rotation: Math.PI / 2 });
  }
  for (const y of stride(70, MAP_HEIGHT - 40, spacing)) {
    place(layer, vine, -45, y + spacing / 2);
    place(layer, vine, TOTAL_WIDTH + 45, y + spacing / 2, { flip: true });
  }
  return layer;
}

// MARK: - Gorodets (secret bonus stage)

/** Gorodets "kupavka": round flower with a dark core, white petal strokes and two green leaves */
function gorodetsFlowerTexture(size: number, petal: Color, core: Color): Texture {
  const ts = size * 2;
  return makeTexture(ts, ts, (ctx) => {
    const cx = ts / 2;
    const cy = ts / 2;
    const green = rgb(0.12, 0.5, 0.22);
    const whiteC = white(1, 0.95);
    ctx.lineCap = "round";

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * size * 0.45, cy + size * 0.35);
      ctx.rotate(side * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * size * 0.3, -size * 0.25, side * size * 0.55, size * 0.1);
      ctx.quadraticCurveTo(side * size * 0.3, size * 0.35, 0, 0);
      fill(ctx, green);
      ctx.fill();
      stroke(ctx, whiteC, 1);
      ctx.beginPath();
      ctx.moveTo(side * size * 0.08, 0);
      ctx.lineTo(side * size * 0.42, size * 0.06);
      ctx.stroke();
      ctx.restore();
    }

    const r = size * 0.55;
    fill(ctx, petal);
    fillEllipse(ctx, cx - r, cy - r * 0.9, r * 2, r * 1.8);
    const cr = r * 0.45;
    fill(ctx, core);
    fillEllipse(ctx, cx - cr, cy - r * 0.75, cr * 2, cr * 1.6);

    stroke(ctx, whiteC, 1.4);
    for (let i = 0; i < 5; i++) {
      const angle = Math.PI * (0.15 + 0.175 * i);
      const px = cx + Math.cos(angle) * r * 0.75;
      const py = cy + Math.sin(angle) * r * 0.65;
      ctx.beginPath();
      // CG (y-down image, clockwise: false) draws the arc the same way as canvas anticlockwise: false
      ctx.arc(px, py, r * 0.22, angle - 1.2, angle + 1.2, false);
      ctx.stroke();
    }
    fill(ctx, whiteC);
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI + (i * Math.PI) / 5;
      const px = cx + Math.cos(angle) * cr * 1.25;
      const py = cy - r * 0.75 + cr * 0.8 + Math.sin(angle) * cr;
      fillEllipse(ctx, px - 1.2, py - 1.2, 2.4, 2.4);
    }
  });
}

/** Gorodets bird in profile: black body, red and green tail sweeping up, white strokes */
function gorodetsBirdTexture(size: number): Texture {
  const ts = size * 2;
  return makeTexture(ts, ts, (ctx) => {
    const cx = ts / 2;
    const cy = ts / 2;
    const black = white(0.08);
    const red = rgb(0.85, 0.12, 0.1);
    const green = rgb(0.12, 0.5, 0.22);
    const whiteC = white(1, 0.95);
    ctx.lineCap = "round";

    [green, red, green].forEach((color, i) => {
      const bx = cx - size * 0.25;
      const by = cy + size * 0.1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(cx - size * 0.9, cy + size * 0.1, cx - size * (0.75 + 0.08 * i), cy - size * (0.7 - 0.25 * i));
      ctx.quadraticCurveTo(cx - size * 0.45, cy - size * 0.35, bx, by);
      fill(ctx, color);
      ctx.fill();
    });

    ctx.beginPath();
    ctx.moveTo(cx + size * 0.35, cy - size * 0.3);
    ctx.quadraticCurveTo(cx + size * 0.5, cy + size * 0.55, cx - size * 0.35, cy + size * 0.15);
    ctx.quadraticCurveTo(cx - size * 0.1, cy - size * 0.2, cx + size * 0.35, cy - size * 0.3);
    fill(ctx, black);
    ctx.fill();

    const hx = cx + size * 0.38;
    const hy = cy - size * 0.38;
    fillEllipse(ctx, hx - size * 0.14, hy - size * 0.14, size * 0.28, size * 0.28);
    fill(ctx, red);
    for (let j = 0; j < 3; j++) fillEllipse(ctx, hx - size * 0.14 + j * size * 0.08, hy - size * 0.26, size * 0.1, size * 0.12);
    fill(ctx, rgb(1, 0.78, 0.2));
    ctx.beginPath();
    ctx.moveTo(hx + size * 0.12, hy - size * 0.04);
    ctx.lineTo(hx + size * 0.28, hy + size * 0.02);
    ctx.lineTo(hx + size * 0.12, hy + size * 0.08);
    ctx.closePath();
    ctx.fill();
    fill(ctx, whiteC);
    fillEllipse(ctx, hx + size * 0.01, hy - size * 0.06, size * 0.08, size * 0.08);

    ctx.beginPath();
    ctx.moveTo(cx + size * 0.15, cy - size * 0.05);
    ctx.quadraticCurveTo(cx, cy + size * 0.35, cx - size * 0.3, cy + size * 0.1);
    ctx.quadraticCurveTo(cx - size * 0.1, cy - size * 0.1, cx + size * 0.15, cy - size * 0.05);
    fill(ctx, red);
    ctx.fill();
    stroke(ctx, whiteC, 1);
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const x = cx + size * (0.05 - 0.12 * j);
      ctx.moveTo(x, cy + size * 0.02);
      ctx.quadraticCurveTo(x + size * 0.03, cy + size * 0.12, x - size * 0.06, cy + size * 0.16);
    }
    ctx.stroke();

    stroke(ctx, black, 1.5);
    ctx.beginPath();
    for (const dx of [-0.02, 0.1]) {
      ctx.moveTo(cx + size * dx, cy + size * 0.3);
      ctx.lineTo(cx + size * dx, cy + size * 0.5);
    }
    ctx.stroke();
  });
}

export function makeGorodetsBorder(): Node {
  const layer = new Node();
  layer.zPosition = -10;
  addGround(layer, rgb(0.93, 0.7, 0.3));
  frame(layer, 6, rgb(0.35, 0.16, 0.05), 4);
  frame(layer, 12, rgb(0.8, 0.12, 0.08), 2);

  const redFlower = gorodetsFlowerTexture(30, rgb(0.85, 0.12, 0.1), rgb(0.5, 0.03, 0.03));
  const blueFlower = gorodetsFlowerTexture(26, rgb(0.2, 0.38, 0.82), rgb(0.06, 0.14, 0.45));
  const bird = gorodetsBirdTexture(30);
  const spacing = 80;

  stride(40, MAP_HEIGHT, spacing).forEach((y, i) => {
    const left = i % 3 === 1 ? bird : i % 2 === 0 ? redFlower : blueFlower;
    const right = i % 3 === 2 ? bird : i % 2 === 0 ? blueFlower : redFlower;
    place(layer, left, -38, y, { flip: true, z: 2 });
    place(layer, right, TOTAL_WIDTH + 38, y, { z: 2 });
  });
  stride(40, TOTAL_WIDTH, spacing).forEach((x, i) => {
    place(layer, i % 2 === 0 ? redFlower : blueFlower, x, MAP_HEIGHT + 36, { z: 2 });
    place(layer, i % 2 === 0 ? blueFlower : redFlower, x, -36, { z: 2 });
  });
  return layer;
}

// MARK: - Khokhloma (alien mode)

/** Khokhloma rowan branch: curved gold stem, gold leaves, a cluster of red berries */
function khokhlomaBranchTexture(size: number): Texture {
  const ts = size * 2;
  return makeTexture(ts, ts, (ctx) => {
    const cx = ts / 2;
    const cy = ts / 2;
    const gold = rgb(0.98, 0.76, 0.2);
    const darkGold = rgb(0.75, 0.5, 0.08);
    const red = rgb(0.85, 0.08, 0.06);
    const darkRed = rgb(0.55, 0.02, 0.02);

    stroke(ctx, gold, size * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.9);
    ctx.bezierCurveTo(cx - size * 0.6, cy + size * 0.3, cx + size * 0.6, cy - size * 0.3, cx, cy - size * 0.85);
    ctx.stroke();

    const leaf = (x: number, y: number, angle: number, length: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(length * 0.5, -length * 0.45, length, 0);
      ctx.quadraticCurveTo(length * 0.5, length * 0.45, 0, 0);
      fill(ctx, gold);
      ctx.fill();
      stroke(ctx, darkGold, 1);
      ctx.beginPath();
      ctx.moveTo(length * 0.1, 0);
      ctx.lineTo(length * 0.85, 0);
      ctx.stroke();
      ctx.restore();
    };
    leaf(cx - size * 0.2, cy + size * 0.5, Math.PI * 0.85, size * 0.5);
    leaf(cx - size * 0.12, cy + size * 0.2, Math.PI * 0.1, size * 0.45);
    leaf(cx + size * 0.12, cy - size * 0.25, -Math.PI * 0.9, size * 0.45);
    leaf(cx + size * 0.15, cy - size * 0.55, -Math.PI * 0.15, size * 0.4);

    for (const [bx, by] of [
      [0.28, -0.02],
      [0.42, 0.14],
      [0.46, -0.14],
      [0.6, 0.02],
      [0.3, 0.26],
    ]) {
      const px = cx + size * bx * 0.9 - size * 0.05;
      const py = cy + size * by;
      const r = size * 0.12;
      fill(ctx, red);
      fillEllipse(ctx, px - r, py - r, r * 2, r * 2);
      stroke(ctx, darkRed, 1);
      strokeEllipse(ctx, px - r, py - r, r * 2, r * 2);
      fill(ctx, white(1, 0.85));
      fillEllipse(ctx, px - r * 0.45, py - r * 0.55, r * 0.5, r * 0.5);
    }
  });
}

/** Khokhloma "kudrina" curl: a gold spiral with little grass strokes */
function khokhlomaCurlTexture(size: number): Texture {
  const ts = size * 2;
  return makeTexture(ts, ts, (ctx) => {
    const cx = ts / 2;
    const cy = ts / 2;
    ctx.strokeStyle = css(rgb(0.98, 0.76, 0.2));
    ctx.lineCap = "round";
    ctx.lineWidth = size * 0.09;
    ctx.beginPath();
    for (let step = 0; step <= 60; step++) {
      const t = step / 60;
      const angle = t * Math.PI * 3.2;
      const radius = size * (0.75 - 0.6 * t);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const angle = -Math.PI * 0.35 - i * 0.3;
      ctx.moveTo(cx + Math.cos(angle) * size * 0.78, cy + Math.sin(angle) * size * 0.78);
      ctx.lineTo(cx + Math.cos(angle) * size * 0.98, cy + Math.sin(angle) * size * 0.98);
    }
    ctx.stroke();
  });
}

export function makeKhokhlomaBorder(): Node {
  const layer = new Node();
  layer.zPosition = -10;
  addGround(layer, rgb(0.06, 0.03, 0.02));
  frame(layer, 6, rgb(0.95, 0.72, 0.2), 3);

  const branch = khokhlomaBranchTexture(34);
  const smallBranch = khokhlomaBranchTexture(28);
  const curl = khokhlomaCurlTexture(22);
  const spacing = 80;

  stride(40, MAP_HEIGHT, spacing).forEach((y, i) => {
    place(layer, branch, -34, y, { flip: i % 2 === 1, z: 2 });
    place(layer, branch, TOTAL_WIDTH + 34, y, { flip: i % 2 === 0, z: 2 });
    place(layer, curl, -40, y + spacing / 2, { z: 2 });
    place(layer, curl, TOTAL_WIDTH + 40, y + spacing / 2, { flip: true, z: 2 });
  });
  stride(40, TOTAL_WIDTH, spacing).forEach((x, i) => {
    place(layer, smallBranch, x, MAP_HEIGHT + 32, { rotation: -Math.PI / 2, flip: i % 2 === 1, z: 2 });
    place(layer, smallBranch, x, -32, { rotation: Math.PI / 2, flip: i % 2 === 0, z: 2 });
    place(layer, curl, x + spacing / 2, MAP_HEIGHT + 38, { rotation: -Math.PI / 2, z: 2 });
    place(layer, curl, x + spacing / 2, -38, { rotation: Math.PI / 2, z: 2 });
  });
  return layer;
}
