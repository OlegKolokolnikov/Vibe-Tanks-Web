import { rgb, white, withAlpha, Colors } from "../engine/color";
import type { Point } from "../engine/geometry";
import { CustomNode, Node, ShapeNode, renderNodeToTexture, type Texture } from "../engine/node";
import { Path } from "../engine/path";
import { C, boxesOverlap } from "./constants";

export enum Tile {
  Empty = 0,
  Brick,
  Steel,
  Water,
  Forest,
  Ice,
}

/** Something with a position and size that can stand on a tile (tanks) */
export interface MapOccupant {
  readonly isAlive: boolean;
  readonly position: Point;
  readonly tankSize: number;
}

/** Small seeded generator (sfc32): same seed, same map */
class SeededRandom {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = (seed ^ 0xdeadbeef) >>> 0;
    // Mix in the high bits too (session seeds are larger than 32 bits)
    this.c = (this.c ^ Math.floor(seed / 4294967296)) >>> 0;
    for (let i = 0; i < 15; i++) this.next();
  }

  next(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }
}

/** Game map with tile-based terrain */
export class GameMap extends Node {
  private static textureCache = new Map<Tile, Texture>();

  private readonly mapWidth = C.mapWidth;
  private readonly mapHeight = C.mapHeight;
  private readonly tileSize = C.tileSize;
  private readonly tiles: Tile[][];
  private readonly random: SeededRandom;
  /** Two-player game: also keep player 2's spawn area (right of the base) clear */
  private readonly clearsPlayer2Spawn: boolean;

  get pixelSize(): { width: number; height: number } {
    return { width: this.mapWidth * this.tileSize, height: this.mapHeight * this.tileSize };
  }

  constructor(level = 1, seed = 0, twoPlayers = false) {
    super();
    this.clearsPlayer2Spawn = twoPlayers;
    this.tiles = Array.from({ length: this.mapHeight }, () => new Array<Tile>(this.mapWidth).fill(Tile.Empty));
    this.random = new SeededRandom(seed !== 0 ? seed : Math.floor(Math.random() * 2 ** 52));

    GameMap.generateTexturesIfNeeded(this.tileSize);
    this.generateLevel();

    // Ground tiles under the tanks; forest above them (z 15)
    this.addChild(new CustomNode((ctx) => this.drawTiles(ctx, false)));
    const forest = new CustomNode((ctx) => this.drawTiles(ctx, true));
    forest.zPosition = 15;
    this.addChild(forest);
  }

  // MARK: Seeded random helpers

  /** Random integer in lo...hi (inclusive) */
  private randomInt(lo: number, hi: number): number {
    if (hi < lo) return lo;
    return lo + Math.floor(this.random.next() * (hi - lo + 1));
  }

  private randomDouble(): number {
    return this.random.next();
  }

  private randomBool(): boolean {
    return this.random.next() < 0.5;
  }

  // MARK: Level generation

  private generateLevel(): void {
    for (let row = 0; row < this.mapHeight; row++) this.tiles[row].fill(Tile.Empty);

    // Border walls (steel)
    for (let i = 0; i < this.mapWidth; i++) {
      this.tiles[0][i] = Tile.Steel;
      this.tiles[this.mapHeight - 1][i] = Tile.Steel;
    }
    for (let i = 0; i < this.mapHeight; i++) {
      this.tiles[i][0] = Tile.Steel;
      this.tiles[i][this.mapWidth - 1] = Tile.Steel;
    }

    // 2-4 main geometric structures
    const numMainStructures = 2 + this.randomInt(0, 2);
    for (let i = 0; i < numMainStructures; i++) this.generateGeometricShape();

    if (this.randomDouble() < 0.7) this.generateSymmetricPattern();

    const numCorridors = 1 + this.randomInt(0, 2);
    for (let i = 0; i < numCorridors; i++) this.generateCorridor();

    // Water features - at least 10% of the playable area
    const numWater = 4 + this.randomInt(0, 3);
    for (let i = 0; i < numWater; i++) this.generateWaterFeature();
    this.ensureMinimumWaterCoverage();

    const numTrees = 1 + this.randomInt(0, 2);
    for (let i = 0; i < numTrees; i++) this.generateTreePatch();

    // Ice patches - at least 10% of the playable area
    const numIce = 5 + this.randomInt(0, 4);
    for (let i = 0; i < numIce; i++) this.generateIcePatch();
    this.ensureMinimumIceCoverage();

    const numScattered = 5 + this.randomInt(0, 9);
    for (let i = 0; i < numScattered; i++) this.generateScatteredBlocks();

    // Less than 50% empty
    this.ensureMinimumContent();

    // Spawn areas after every shape, so nothing is placed over them again
    this.clearSpawnAreas();
    // Base protection after the shapes so nothing overwrites it
    this.createBaseProtection();
    // Never lock anyone in: open a way through steel/water if a spawn is cut off
    this.ensureSpawnsReachable();
  }

  // MARK: Reachability

  /** Tanks can drive through these, or shoot their way through (brick) */
  private static isPassable(tile: Tile): boolean {
    return tile !== Tile.Steel && tile !== Tile.Water;
  }

  /**
   * Every enemy spawn (and player 2's) must connect to player 1's spawn without crossing
   * steel or water. If one is cut off, the cheapest path is opened by clearing the few
   * steel/water tiles on it.
   */
  private ensureSpawnsReachable(): void {
    const start = { row: this.mapHeight - 2, col: 8 };
    const targets = [
      { row: 1, col: 2 },
      { row: 1, col: Math.floor(this.mapWidth / 2) },
      { row: 1, col: this.mapWidth - 3 },
    ];
    if (this.clearsPlayer2Spawn) targets.push({ row: this.mapHeight - 2, col: 18 });

    // Free if passable, 1 per steel/water tile to clear; the base walls are avoided
    const cost = (row: number, col: number) => {
      if (GameMap.isPassable(this.tiles[row][col])) return 0;
      const nearBase = col >= 12 && col <= 14 && row >= 18;
      return nearBase ? 1000 : 1;
    };
    const inner = (r: number, c: number) => r >= 1 && r <= this.mapHeight - 2 && c >= 1 && c <= this.mapWidth - 2;

    const dist = Array.from({ length: this.mapHeight }, () => new Array<number>(this.mapWidth).fill(Infinity));
    const previous = Array.from({ length: this.mapHeight }, () => new Array<[number, number]>(this.mapWidth).fill([-1, -1]));
    const frontier: [number, number, number][] = [[0, start.row, start.col]];
    dist[start.row][start.col] = 0;
    while (frontier.length) {
      let best = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[best][0]) best = i;
      const [d, row, col] = frontier.splice(best, 1)[0];
      if (d !== dist[row][col]) continue;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const r = row + dr;
        const c = col + dc;
        if (!inner(r, c)) continue;
        const next = d + cost(r, c);
        if (next < dist[r][c]) {
          dist[r][c] = next;
          previous[r][c] = [row, col];
          frontier.push([next, r, c]);
        }
      }
    }

    for (const target of targets) {
      const d = dist[target.row][target.col];
      if (!(d > 0 && d !== Infinity)) continue;
      // Walk back from the spawn and clear what blocks the way
      let r = target.row;
      let c = target.col;
      while (!(r === start.row && c === start.col)) {
        if (!GameMap.isPassable(this.tiles[r][c])) this.tiles[r][c] = Tile.Empty;
        [r, c] = previous[r][c];
      }
    }
  }

  // MARK: Geometric shapes

  private generateGeometricShape(): void {
    const shapeType = this.randomInt(0, 7);
    const centerCol = 4 + this.randomInt(0, this.mapWidth - 9);
    const centerRow = 5 + this.randomInt(0, this.mapHeight - 15);
    const type = this.randomDouble() < 0.75 ? Tile.Brick : Tile.Steel;

    switch (shapeType) {
      case 0:
        this.generateHollowRectangle(centerRow, centerCol, type);
        break;
      case 1:
        this.generateCross(centerRow, centerCol, type);
        break;
      case 2:
        this.generateDiamond(centerRow, centerCol, type);
        break;
      case 3:
        this.generateLShape(centerRow, centerCol, type);
        break;
      case 4:
        this.generateTShape(centerRow, centerCol, type);
        break;
      case 5:
        this.generateUShape(centerRow, centerCol, type);
        break;
      case 6:
        this.generateZigzag(centerRow, centerCol, type);
        break;
      default:
        this.generateSpiral(centerRow, centerCol, type);
    }
  }

  private generateHollowRectangle(startRow: number, startCol: number, type: Tile): void {
    const w = 4 + this.randomInt(0, 3);
    const h = 3 + this.randomInt(0, 2);
    for (let col = startCol; col < startCol + w; col++) {
      this.placeTile(startRow, col, type);
      this.placeTile(startRow + h - 1, col, type);
    }
    for (let row = startRow; row < startRow + h; row++) {
      this.placeTile(row, startCol, type);
      this.placeTile(row, startCol + w - 1, type);
    }
    // Opening
    switch (this.randomInt(0, 3)) {
      case 0:
        this.placeTile(startRow, startCol + Math.floor(w / 2), Tile.Empty);
        break;
      case 1:
        this.placeTile(startRow + h - 1, startCol + Math.floor(w / 2), Tile.Empty);
        break;
      case 2:
        this.placeTile(startRow + Math.floor(h / 2), startCol, Tile.Empty);
        break;
      default:
        this.placeTile(startRow + Math.floor(h / 2), startCol + w - 1, Tile.Empty);
    }
  }

  private generateCross(centerRow: number, centerCol: number, type: Tile): void {
    const armLength = 2 + this.randomInt(0, 2);
    for (let i = -armLength; i <= armLength; i++) {
      this.placeTile(centerRow + i, centerCol, type);
      this.placeTile(centerRow, centerCol + i, type);
    }
  }

  private generateDiamond(centerRow: number, centerCol: number, type: Tile): void {
    const size = 2 + this.randomInt(0, 1);
    for (let i = 0; i <= size; i++) {
      this.placeTile(centerRow - i, centerCol - (size - i), type);
      this.placeTile(centerRow - i, centerCol + (size - i), type);
      this.placeTile(centerRow + i, centerCol - (size - i), type);
      this.placeTile(centerRow + i, centerCol + (size - i), type);
    }
  }

  private generateLShape(startRow: number, startCol: number, type: Tile): void {
    const vertLen = 3 + this.randomInt(0, 2);
    const horizLen = 3 + this.randomInt(0, 2);
    const flipped = this.randomBool();
    const rotated = this.randomBool();
    for (let i = 0; i < vertLen; i++) {
      const col = flipped ? startCol + horizLen - 1 : startCol;
      this.placeTile(startRow + i, col, type);
    }
    const horizRow = rotated ? startRow : startRow + vertLen - 1;
    for (let i = 0; i < horizLen; i++) this.placeTile(horizRow, startCol + i, type);
  }

  private generateTShape(startRow: number, startCol: number, type: Tile): void {
    const topWidth = 4 + this.randomInt(0, 2);
    const stemHeight = 2 + this.randomInt(0, 2);
    for (let i = 0; i < topWidth; i++) this.placeTile(startRow, startCol + i, type);
    const stemCol = startCol + Math.floor(topWidth / 2);
    for (let i = 1; i <= stemHeight; i++) this.placeTile(startRow + i, stemCol, type);
  }

  private generateUShape(startRow: number, startCol: number, type: Tile): void {
    const w = 3 + this.randomInt(0, 2);
    const h = 3 + this.randomInt(0, 1);
    for (let i = 0; i < h; i++) {
      this.placeTile(startRow + i, startCol, type);
      this.placeTile(startRow + i, startCol + w - 1, type);
    }
    for (let i = 0; i < w; i++) this.placeTile(startRow + h - 1, startCol + i, type);
  }

  private generateZigzag(startRow: number, startCol: number, type: Tile): void {
    const segments = 2 + this.randomInt(0, 1);
    const segLen = 2 + this.randomInt(0, 1);
    let goingRight = this.randomBool();
    let row = startRow;
    let col = startCol;
    for (let s = 0; s < segments; s++) {
      for (let i = 0; i < segLen; i++) this.placeTile(row, col + (goingRight ? i : -i), type);
      col += goingRight ? segLen - 1 : -(segLen - 1);
      for (let i = 1; i < segLen; i++) this.placeTile(row + i, col, type);
      row += segLen - 1;
      goingRight = !goingRight;
    }
  }

  private generateSpiral(centerRow: number, centerCol: number, type: Tile): void {
    const spiral = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 3],
      [2, 3],
      [2, 2],
      [2, 1],
      [2, 0],
      [1, 0],
    ];
    for (const [r, c] of spiral) this.placeTile(centerRow + r, centerCol + c, type);
  }

  // MARK: Symmetric patterns

  private generateSymmetricPattern(): void {
    const patternType = this.randomInt(0, 2);
    const centerCol = Math.floor(this.mapWidth / 2);
    const type = this.randomDouble() < 0.7 ? Tile.Brick : Tile.Steel;
    if (patternType === 0) this.generateSymmetricWalls(centerCol, type);
    else if (patternType === 1) this.generateSymmetricPillars(centerCol, type);
    else this.generateSymmetricMaze(centerCol, type);
  }

  private generateSymmetricWalls(centerCol: number, type: Tile): void {
    const wallRow = 8 + this.randomInt(0, 5);
    const wallLength = 3 + this.randomInt(0, 3);
    const offset = 3 + this.randomInt(0, 3);
    for (let i = 0; i < wallLength; i++) {
      this.placeTile(wallRow + i, centerCol - offset, type);
      this.placeTile(wallRow + i, centerCol + offset - 1, type);
    }
  }

  private generateSymmetricPillars(centerCol: number, type: Tile): void {
    const numPillars = 2 + this.randomInt(0, 1);
    const spacing = 4 + this.randomInt(0, 2);
    for (let p = 0; p < numPillars; p++) {
      const row = 6 + p * spacing;
      const offset = 4 + this.randomInt(0, 3);
      for (const [r, c] of [
        [row, centerCol - offset],
        [row + 1, centerCol - offset],
        [row, centerCol - offset + 1],
        [row + 1, centerCol - offset + 1],
        [row, centerCol + offset - 2],
        [row + 1, centerCol + offset - 2],
        [row, centerCol + offset - 1],
        [row + 1, centerCol + offset - 1],
      ]) {
        this.placeTile(r, c, type);
      }
    }
  }

  private generateSymmetricMaze(centerCol: number, type: Tile): void {
    const pattern = [
      [6, -6],
      [6, -5],
      [7, -5],
      [10, -8],
      [10, -7],
      [11, -7],
      [11, -6],
      [14, -5],
      [14, -4],
      [14, -3],
      [15, -3],
    ];
    for (const [r, c] of pattern) {
      this.placeTile(r, centerCol + c, type);
      this.placeTile(r, centerCol - c - 1, type);
    }
  }

  // MARK: Corridors

  private generateCorridor(): void {
    const horizontal = this.randomBool();
    const type = this.randomDouble() < 0.6 ? Tile.Brick : Tile.Steel;
    if (horizontal) {
      const row = 5 + this.randomInt(0, this.mapHeight - 13);
      const startCol = 2 + this.randomInt(0, 4);
      const length = 4 + this.randomInt(0, 7);
      for (let i = 0; i < length; i++) this.placeTile(row, startCol + i, type);
      if (length > 4) this.placeTile(row, startCol + Math.floor(length / 2), Tile.Empty);
    } else {
      const col = 3 + this.randomInt(0, this.mapWidth - 7);
      const startRow = 4 + this.randomInt(0, 4);
      const length = 3 + this.randomInt(0, 5);
      for (let i = 0; i < length; i++) this.placeTile(startRow + i, col, type);
      if (length > 3) this.placeTile(startRow + Math.floor(length / 2), col, Tile.Empty);
    }
  }

  // MARK: Water

  private generateWaterFeature(): void {
    const featureType = this.randomInt(0, 2);
    if (featureType === 0) this.generateWaterPool();
    else if (featureType === 1) this.generateWaterRiver();
    else this.generateWaterLake();
  }

  private generateWaterPool(): void {
    const poolRow = 6 + this.randomInt(0, this.mapHeight - 15);
    const poolCol = 3 + this.randomInt(0, this.mapWidth - 9);
    const poolWidth = 2 + this.randomInt(0, 1);
    const poolHeight = 2 + this.randomInt(0, 1);
    for (let r = 0; r < poolHeight; r++) for (let c = 0; c < poolWidth; c++) this.placeTile(poolRow + r, poolCol + c, Tile.Water);
  }

  private generateWaterRiver(): void {
    if (this.randomBool()) {
      const row = 8 + this.randomInt(0, this.mapHeight - 17);
      for (let c = 2; c <= this.mapWidth - 4; c++) {
        const wobble = this.randomInt(-1, 1);
        const actualRow = Math.max(1, Math.min(this.mapHeight - 2, row + wobble));
        this.placeTile(actualRow, c, Tile.Water);
      }
    } else {
      const col = 6 + this.randomInt(0, this.mapWidth - 13);
      for (let r = 2; r <= this.mapHeight - 9; r++) {
        const wobble = this.randomInt(-1, 1);
        const actualCol = Math.max(1, Math.min(this.mapWidth - 2, col + wobble));
        this.placeTile(r, actualCol, Tile.Water);
      }
    }
  }

  private generateWaterLake(): void {
    const lakeRow = 8 + this.randomInt(0, this.mapHeight - 19);
    const lakeCol = 5 + this.randomInt(0, this.mapWidth - 13);
    const lakeSize = 3 + this.randomInt(0, 1);
    for (let r = -lakeSize; r <= lakeSize; r++) {
      for (let c = -lakeSize; c <= lakeSize; c++) {
        if (r * r + c * c <= lakeSize * lakeSize) this.placeTile(lakeRow + r, lakeCol + c, Tile.Water);
      }
    }
  }

  private generateWaterPond(): void {
    const pondRow = 6 + this.randomInt(0, this.mapHeight - 15);
    const pondCol = 4 + this.randomInt(0, this.mapWidth - 11);
    const pondWidth = 3 + this.randomInt(0, 2);
    const pondHeight = 3 + this.randomInt(0, 2);
    for (let r = 0; r < pondHeight; r++) for (let c = 0; c < pondWidth; c++) this.placeTile(pondRow + r, pondCol + c, Tile.Water);
  }

  // MARK: Trees

  private generateTreePatch(): void {
    const patchType = this.randomInt(0, 2);
    if (patchType === 0) this.generateTreeCluster();
    else if (patchType === 1) this.generateTreeLine();
    else this.generateTreeForest();
  }

  private generateTreeCluster(): void {
    const clusterRow = 4 + this.randomInt(0, this.mapHeight - 11);
    const clusterCol = 3 + this.randomInt(0, this.mapWidth - 9);
    const numTrees = 3 + this.randomInt(0, 3);
    for (let i = 0; i < numTrees; i++) {
      const offsetRow = this.randomInt(-1, 1);
      const offsetCol = this.randomInt(-1, 1);
      this.placeTile(clusterRow + offsetRow, clusterCol + offsetCol, Tile.Forest);
    }
  }

  private generateTreeLine(): void {
    if (this.randomBool()) {
      const row = 3 + this.randomInt(0, this.mapHeight - 9);
      const startCol = 2 + this.randomInt(0, 4);
      const length = 3 + this.randomInt(0, 4);
      for (let i = 0; i < length; i++) this.placeTile(row, startCol + i, Tile.Forest);
    } else {
      const col = 2 + this.randomInt(0, this.mapWidth - 7);
      const startRow = 3 + this.randomInt(0, 4);
      const length = 3 + this.randomInt(0, 4);
      for (let i = 0; i < length; i++) this.placeTile(startRow + i, col, Tile.Forest);
    }
  }

  private generateTreeForest(): void {
    const forestRow = 5 + this.randomInt(0, this.mapHeight - 13);
    const forestCol = 4 + this.randomInt(0, this.mapWidth - 11);
    const forestWidth = 3 + this.randomInt(0, 2);
    const forestHeight = 2 + this.randomInt(0, 1);
    for (let r = 0; r < forestHeight; r++) {
      for (let c = 0; c < forestWidth; c++) {
        if (this.randomDouble() < 0.7) this.placeTile(forestRow + r, forestCol + c, Tile.Forest);
      }
    }
  }

  // MARK: Ice

  private generateIcePatch(): void {
    if (this.randomInt(0, 1) === 0) this.generateIceRink();
    else this.generateIcePath();
  }

  private generateIceRink(): void {
    const rinkRow = 6 + this.randomInt(0, this.mapHeight - 15);
    const rinkCol = 4 + this.randomInt(0, this.mapWidth - 11);
    const rinkWidth = 3 + this.randomInt(0, 2);
    const rinkHeight = 2 + this.randomInt(0, 1);
    for (let r = 0; r < rinkHeight; r++) for (let c = 0; c < rinkWidth; c++) this.placeTile(rinkRow + r, rinkCol + c, Tile.Ice);
  }

  private generateIcePath(): void {
    if (this.randomBool()) {
      const row = 8 + this.randomInt(0, this.mapHeight - 17);
      const startCol = 3 + this.randomInt(0, 4);
      const length = 4 + this.randomInt(0, 5);
      for (let i = 0; i < length; i++) this.placeTile(row, startCol + i, Tile.Ice);
    } else {
      const col = 5 + this.randomInt(0, this.mapWidth - 11);
      const startRow = 4 + this.randomInt(0, 4);
      const length = 3 + this.randomInt(0, 4);
      for (let i = 0; i < length; i++) this.placeTile(startRow + i, col, Tile.Ice);
    }
  }

  private generateIceLake(): void {
    const lakeRow = 8 + this.randomInt(0, this.mapHeight - 19);
    const lakeCol = 5 + this.randomInt(0, this.mapWidth - 13);
    const lakeWidth = 3 + this.randomInt(0, 2);
    const lakeHeight = 3 + this.randomInt(0, 2);
    for (let r = 0; r < lakeHeight; r++) for (let c = 0; c < lakeWidth; c++) this.placeTile(lakeRow + r, lakeCol + c, Tile.Ice);
  }

  // MARK: Scattered blocks

  private generateScatteredBlocks(): void {
    const row = 2 + this.randomInt(0, this.mapHeight - 7);
    const col = 2 + this.randomInt(0, this.mapWidth - 5);
    const roll = this.randomDouble();
    const type = roll < 0.5 ? Tile.Brick : roll < 0.7 ? Tile.Steel : roll < 0.85 ? Tile.Forest : Tile.Water;
    const size = 1 + this.randomInt(0, 1);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) this.placeTile(row + r, col + c, type);
  }

  // MARK: Helpers

  private placeTile(row: number, col: number, type: Tile): void {
    if (!(row > 0 && row < this.mapHeight - 1 && col > 0 && col < this.mapWidth - 1)) return;
    // Don't overwrite the base area (rows 23-24, cols 12-14)
    if (row >= 23 && row <= 24 && col >= 12 && col <= 14) return;
    this.tiles[row][col] = type;
  }

  private percentage(type: Tile): number {
    let total = 0;
    let count = 0;
    for (let row = 1; row < this.mapHeight - 1; row++) {
      for (let col = 1; col < this.mapWidth - 1; col++) {
        total++;
        if (this.tiles[row][col] === type) count++;
      }
    }
    return count / total;
  }

  private ensureMinimumContent(): void {
    let attempts = 0;
    while (this.percentage(Tile.Empty) > 0.5 && attempts < 50) {
      switch (this.randomInt(0, 4)) {
        case 0:
          this.generateGeometricShape();
          break;
        case 1:
          this.generateCorridor();
          break;
        case 2:
          this.generateScatteredBlocks();
          break;
        case 3:
          this.generateTreePatch();
          break;
        default:
          for (let i = 0; i < 3; i++) this.generateScatteredBlocks();
      }
      attempts++;
    }
    if (attempts > 0) this.clearSpawnAreas();
  }

  private ensureMinimumWaterCoverage(): void {
    let attempts = 0;
    while (this.percentage(Tile.Water) < 0.1 && attempts < 30) {
      if (attempts % 3 === 0) this.generateWaterPool();
      else if (attempts % 3 === 1) this.generateWaterLake();
      else this.generateWaterPond();
      attempts++;
    }
    if (attempts > 0) this.clearSpawnAreas();
  }

  private ensureMinimumIceCoverage(): void {
    let attempts = 0;
    while (this.percentage(Tile.Ice) < 0.1 && attempts < 30) {
      if (attempts % 3 === 0) this.generateIceRink();
      else if (attempts % 3 === 1) this.generateIcePath();
      else this.generateIceLake();
      attempts++;
    }
    if (attempts > 0) this.clearSpawnAreas();
  }

  private clearSpawnAreas(): void {
    const clear = (r0: number, r1: number, c0: number, c1: number) => {
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) this.tiles[row][col] = Tile.Empty;
    };
    clear(1, 2, 1, 4); // Enemy spawn 1 (left)
    clear(1, 8, 9, 17); // Enemy spawn 2 (center) - wider and taller for the boss
    clear(1, 2, this.mapWidth - 5, this.mapWidth - 2); // Enemy spawn 3 (right)
    clear(23, this.mapHeight - 2, 7, 9); // Player spawn
    if (this.clearsPlayer2Spawn) clear(23, this.mapHeight - 2, 17, 19); // Player 2 spawn
  }

  private createBaseProtection(): void {
    // Tight U-shaped brick protection around the eagle (base at col 13, row 24)
    this.tiles[23][12] = Tile.Brick;
    this.tiles[23][13] = Tile.Brick;
    this.tiles[23][14] = Tile.Brick;
    this.tiles[24][12] = Tile.Brick;
    this.tiles[24][14] = Tile.Brick;
    this.tiles[24][13] = Tile.Empty;
    // Steel barrier above the base - prevents shooting it directly from the top
    for (const row of [18, 19]) for (const col of [12, 13, 14]) this.tiles[row][col] = Tile.Steel;
  }

  // MARK: Rendering

  private drawTiles(ctx: CanvasRenderingContext2D, forest: boolean): void {
    const ts = this.tileSize;
    ctx.scale(1, -1); // Textures are stored top row first
    for (let row = 0; row < this.mapHeight; row++) {
      const tilesRow = this.tiles[row];
      for (let col = 0; col < this.mapWidth; col++) {
        const tile = tilesRow[col];
        if (tile === Tile.Empty || (tile === Tile.Forest) !== forest) continue;
        const texture = GameMap.textureCache.get(tile);
        if (!texture) continue;
        // Tile top edge in the y-up world is (mapHeight - row) * ts; flipped: -(that)
        ctx.drawImage(texture, col * ts, -(this.mapHeight - row) * ts, ts, ts);
      }
    }
  }

  // MARK: Texture generation (called once)

  private static generateTexturesIfNeeded(tileSize: number): void {
    if (GameMap.textureCache.size) return;
    GameMap.textureCache.set(Tile.Brick, GameMap.render(GameMap.brickNode(tileSize), tileSize));
    GameMap.textureCache.set(Tile.Steel, GameMap.render(GameMap.steelNode(tileSize), tileSize));
    GameMap.textureCache.set(Tile.Water, GameMap.render(GameMap.waterNode(tileSize), tileSize));
    GameMap.textureCache.set(Tile.Forest, GameMap.render(GameMap.forestNode(tileSize), tileSize));
    GameMap.textureCache.set(Tile.Ice, GameMap.render(GameMap.iceNode(tileSize), tileSize));
  }

  private static render(node: Node, tileSize: number): Texture {
    return renderNodeToTexture(node, tileSize, tileSize);
  }

  private static shape(path: Path, fill = Colors.clear, stroke = Colors.clear, lineWidth = 1): ShapeNode {
    const node = new ShapeNode(path);
    node.fillColor = fill;
    node.strokeColor = stroke;
    node.lineWidth = lineWidth;
    return node;
  }

  private static at<T extends Node>(node: T, x: number, y: number): T {
    node.position = { x, y };
    return node;
  }

  private static brickNode(tileSize: number): Node {
    const node = new Node();
    const half = tileSize / 2;
    node.addChild(GameMap.shape(Path.rectCentered(tileSize, tileSize), rgb(0.35, 0.25, 0.15))); // Dark mortar

    const brickWidth = tileSize / 2 - 1;
    const brickHeight = tileSize / 4 - 1;
    const mortarGap = 1.5;
    const brickColors = [rgb(0.72, 0.32, 0.15), rgb(0.68, 0.28, 0.12), rgb(0.75, 0.35, 0.18), rgb(0.65, 0.3, 0.14)];

    // 4 rows of bricks (alternating offset pattern)
    for (let row = 0; row < 4; row++) {
      const yPos = -half + row * (brickHeight + mortarGap) + brickHeight / 2 + mortarGap / 2;
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let col = 0; col < 3; col++) {
        const xPos = -half + col * (brickWidth + mortarGap) + brickWidth / 2 + mortarGap / 2 + offset - brickWidth / 4;
        if (!(xPos > -half - brickWidth / 2 && xPos < half + brickWidth / 2)) continue;
        const brick = GameMap.at(
          GameMap.shape(Path.rectCentered(brickWidth, brickHeight, 1), brickColors[(row + col) % brickColors.length], rgb(0.5, 0.2, 0.1), 0.5),
          xPos,
          yPos,
        );
        // Subtle highlight on the top edge, shadow on the bottom edge
        brick.addChild(GameMap.at(GameMap.shape(Path.rectCentered(brickWidth - 2, 1), withAlpha(Colors.white, 0.15)), 0, brickHeight / 2 - 1.5));
        brick.addChild(GameMap.at(GameMap.shape(Path.rectCentered(brickWidth - 2, 1), withAlpha(Colors.black, 0.2)), 0, -brickHeight / 2 + 1.5));
        node.addChild(brick);
      }
    }
    return node;
  }

  private static steelNode(tileSize: number): Node {
    const node = new Node();
    const half = tileSize / 2;
    node.addChild(GameMap.shape(Path.rectCentered(tileSize, tileSize), rgb(0.45, 0.48, 0.52), rgb(0.25, 0.28, 0.32), 2));

    // Rivets in the corners
    for (const [x, y] of [
      [-half + 5, -half + 5],
      [half - 5, -half + 5],
      [-half + 5, half - 5],
      [half - 5, half - 5],
    ]) {
      node.addChild(GameMap.at(GameMap.shape(Path.circle(2), rgb(0.3, 0.32, 0.35), rgb(0.55, 0.58, 0.62), 0.5), x, y));
    }

    // Metallic shine (diagonal)
    const shine = new Path()
      .moveTo(-half + 4, half - 4)
      .lineTo(-half + 12, half - 4)
      .lineTo(-half + 4, half - 12)
      .close();
    node.addChild(GameMap.shape(shine, withAlpha(Colors.white, 0.25)));

    // Barbed wire across the top
    const wireY = half - 6;
    const wireColor = white(0.25);
    node.addChild(GameMap.shape(new Path().moveTo(-half, wireY).lineTo(half, wireY), Colors.clear, wireColor, 1.5));
    node.addChild(GameMap.shape(new Path().moveTo(-half, wireY - 4).lineTo(half, wireY - 4), Colors.clear, wireColor, 1));

    const barbSpacing = 8;
    const numBarbs = Math.floor(tileSize / barbSpacing);
    for (let i = 0; i < numBarbs; i++) {
      const barbX = -half + i * barbSpacing + barbSpacing / 2;
      const barb = new Path()
        .moveTo(barbX - 2, wireY + 3)
        .lineTo(barbX + 2, wireY - 3)
        .moveTo(barbX + 2, wireY + 3)
        .lineTo(barbX - 2, wireY - 3)
        .moveTo(barbX, wireY)
        .lineTo(barbX - 1.5, wireY + 4)
        .moveTo(barbX, wireY)
        .lineTo(barbX + 1.5, wireY - 5);
      const barbNode = GameMap.shape(barb, Colors.clear, wireColor, 1);
      barbNode.lineCap = "round";
      node.addChild(barbNode);
    }
    return node;
  }

  private static waterNode(tileSize: number): Node {
    const node = new Node();
    const half = tileSize / 2;
    node.addChild(GameMap.shape(Path.rectCentered(tileSize, tileSize), rgb(0.15, 0.4, 0.75), rgb(0.1, 0.25, 0.5), 1));

    for (const [x, y] of [
      [6, 5],
      [18, 8],
      [10, 20],
      [24, 15],
      [4, 26],
      [20, 25],
      [14, 12],
      [28, 6],
      [8, 14],
      [26, 22],
    ]) {
      node.addChild(GameMap.at(GameMap.shape(Path.circle(1.5), rgb(0.08, 0.25, 0.55, 0.8)), -half + x, -half + y));
    }

    // White wave lines
    const wave1 = new Path()
      .moveTo(-half, 6)
      .quadTo(-half + 8, 10, -half / 2, 6)
      .quadTo(-4, 2, 0, 6)
      .quadTo(half / 2, 10, half, 6);
    const w1 = GameMap.shape(wave1, Colors.clear, withAlpha(Colors.white, 0.5), 1.5);
    w1.lineCap = "round";
    node.addChild(w1);

    const wave2 = new Path()
      .moveTo(-half, -6)
      .quadTo(-half + 6, -2, -half / 2, -6)
      .quadTo(0, -10, 4, -6)
      .quadTo(half - 4, -2, half, -6);
    const w2 = GameMap.shape(wave2, Colors.clear, withAlpha(Colors.white, 0.4), 1);
    w2.lineCap = "round";
    node.addChild(w2);

    node.addChild(GameMap.at(GameMap.shape(Path.circle(2), withAlpha(Colors.white, 0.3)), -6, 10));
    node.addChild(GameMap.at(GameMap.shape(Path.circle(1.5), withAlpha(Colors.white, 0.25)), 8, -8));
    return node;
  }

  private static forestNode(tileSize: number): Node {
    const node = new Node();
    const half = tileSize / 2;
    node.addChild(GameMap.shape(Path.rectCentered(tileSize, tileSize), rgb(0.15, 0.4, 0.1, 0.6)));

    const foliage = [rgb(0.1, 0.5, 0.15, 0.95), rgb(0.05, 0.45, 0.1, 0.95), rgb(0.15, 0.55, 0.2, 0.95), rgb(0.0, 0.4, 0.1, 0.95)];
    const positions = [
      [-half / 2 + 2, -half / 2 + 2],
      [half / 2 - 2, -half / 2 + 2],
      [-half / 2 + 2, half / 2 - 2],
      [half / 2 - 2, half / 2 - 2],
    ];
    positions.forEach(([x, y], index) => {
      node.addChild(GameMap.at(GameMap.shape(Path.rectCentered(3, 8), rgb(0.4, 0.25, 0.1), rgb(0.3, 0.15, 0.05), 0.5), x, y - 3));
      node.addChild(
        GameMap.shape(
          new Path().moveTo(x, y + 8).lineTo(x - 7, y - 1).lineTo(x + 7, y - 1).close(),
          foliage[index % 4],
          rgb(0.0, 0.3, 0.05),
          0.5,
        ),
      );
      node.addChild(GameMap.shape(new Path().moveTo(x, y + 11).lineTo(x - 5, y + 3).lineTo(x + 5, y + 3).close(), withAlpha(foliage[(index + 1) % 4], 0.9)));
      node.addChild(GameMap.shape(new Path().moveTo(x, y + 13).lineTo(x - 3, y + 7).lineTo(x + 3, y + 7).close(), withAlpha(foliage[(index + 2) % 4], 0.85)));
    });
    return node;
  }

  private static iceNode(tileSize: number): Node {
    const node = new Node();
    const half = tileSize / 2;
    node.addChild(GameMap.shape(Path.rectCentered(tileSize, tileSize), rgb(0.85, 0.88, 0.92), rgb(0.7, 0.75, 0.8), 1));

    for (const [x, y] of [
      [5, 7],
      [15, 4],
      [8, 18],
      [22, 12],
      [3, 28],
      [18, 24],
      [26, 8],
      [12, 14],
      [28, 20],
      [6, 22],
    ]) {
      node.addChild(GameMap.at(GameMap.shape(Path.circle(1.2), rgb(0.65, 0.68, 0.72, 0.7)), -half + x, -half + y));
    }

    const crack = (points: number[][], alpha: number, width: number) => {
      const path = new Path().moveTo(-half + points[0][0], -half + points[0][1]);
      for (const [x, y] of points.slice(1)) path.lineTo(-half + x, -half + y);
      const shape = GameMap.shape(path, Colors.clear, rgb(0.7, 0.73, 0.78, alpha), width);
      shape.lineCap = "round";
      node.addChild(shape);
    };
    crack(
      [
        [4, 6],
        [10, 12],
        [8, 18],
        [14, 22],
      ],
      0.8,
      1,
    );
    crack(
      [
        [20, 2],
        [18, 10],
        [24, 16],
      ],
      0.7,
      0.8,
    );
    crack(
      [
        [26, 24],
        [20, 28],
        [16, 26],
      ],
      0.6,
      0.8,
    );

    node.addChild(GameMap.at(GameMap.shape(Path.rectCentered(6, 3, 1), withAlpha(Colors.white, 0.5)), -6, 8));
    node.addChild(GameMap.at(GameMap.shape(Path.rectCentered(4, 2, 1), withAlpha(Colors.white, 0.4)), 7, -4));
    return node;
  }

  // MARK: Collision detection

  checkTankCollision(position: Point, size: number, canSwim = false): boolean {
    const halfSize = size / 2;
    if (
      position.x - halfSize < 0 ||
      position.x + halfSize > this.mapWidth * this.tileSize ||
      position.y - halfSize < 0 ||
      position.y + halfSize > this.mapHeight * this.tileSize
    ) {
      return true;
    }

    // Tile coordinates (y is flipped)
    const minCol = Math.max(0, Math.floor((position.x - halfSize) / this.tileSize));
    const maxCol = Math.min(this.mapWidth - 1, Math.floor((position.x + halfSize) / this.tileSize));
    const minRow = Math.max(0, this.mapHeight - 1 - Math.floor((position.y + halfSize) / this.tileSize));
    const maxRow = Math.min(this.mapHeight - 1, this.mapHeight - 1 - Math.floor((position.y - halfSize) / this.tileSize));
    if (minCol > maxCol || minRow > maxRow) return true;

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const tile = this.tiles[row][col];
        if (tile === Tile.Brick || tile === Tile.Steel) return true;
        if (tile === Tile.Water && !canSwim) return true;
      }
    }
    return false;
  }

  private tileIndex(position: Point): { row: number; col: number } | null {
    const col = Math.trunc(position.x / this.tileSize);
    const row = this.mapHeight - 1 - Math.trunc(position.y / this.tileSize);
    if (row < 0 || row >= this.mapHeight || col < 0 || col >= this.mapWidth) return null;
    return { row, col };
  }

  checkBulletCollision(position: Point, power: number): { hit: boolean; tileDestroyed: boolean } {
    const index = this.tileIndex(position);
    if (!index) return { hit: true, tileDestroyed: false };
    const { row, col } = index;
    switch (this.tiles[row][col]) {
      case Tile.Brick:
        this.tiles[row][col] = Tile.Empty;
        return { hit: true, tileDestroyed: true };
      case Tile.Steel:
        if (power >= 2) {
          this.tiles[row][col] = Tile.Empty;
          return { hit: true, tileDestroyed: true };
        }
        return { hit: true, tileDestroyed: false };
      default:
        return { hit: false, tileDestroyed: false }; // Bullets pass water, ice, forest
    }
  }

  isIceTile(position: Point): boolean {
    return this.getTile(position) === Tile.Ice;
  }

  getTile(position: Point): Tile {
    const index = this.tileIndex(position);
    return index ? this.tiles[index.row][index.col] : Tile.Empty;
  }

  // MARK: Base protection

  /**
   * Set base protection tiles to steel or brick. A tile a tank is standing on is left
   * open (the wall would lock the tank in); it is filled on a later call once the tank has moved.
   */
  setBaseProtection(steel: boolean, avoiding: MapOccupant[] = []): void {
    const type = steel ? Tile.Steel : Tile.Brick;
    for (const [row, col] of [
      [23, 12],
      [23, 13],
      [23, 14],
      [24, 12],
      [24, 14],
    ]) {
      const center = { x: col * this.tileSize + this.tileSize / 2, y: (this.mapHeight - 1 - row) * this.tileSize + this.tileSize / 2 };
      const occupied = avoiding.some((tank) => tank.isAlive && boxesOverlap(center, this.tileSize, tank.position, tank.tankSize));
      if (!occupied) this.tiles[row][col] = type;
    }
  }

  /** Remove all base protection tiles */
  clearBaseProtection(): void {
    for (const [row, col] of [
      [23, 12],
      [23, 13],
      [23, 14],
      [24, 12],
      [24, 14],
    ]) {
      this.tiles[row][col] = Tile.Empty;
    }
  }

  /** Destroy a forest tile (SAW power-up) */
  destroyForest(position: Point): boolean {
    const index = this.tileIndex(position);
    if (index && this.tiles[index.row][index.col] === Tile.Forest) {
      this.tiles[index.row][index.col] = Tile.Empty;
      return true;
    }
    return false;
  }
}
