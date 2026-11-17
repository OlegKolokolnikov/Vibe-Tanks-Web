/** Movement direction for tanks and bullets */
export enum Direction {
  Up = "up",
  Down = "down",
  Left = "left",
  Right = "right",
}

export const ALL_DIRECTIONS: readonly Direction[] = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];

/** Velocity vector (y up) */
export function velocity(d: Direction): { dx: number; dy: number } {
  switch (d) {
    case Direction.Up:
      return { dx: 0, dy: 1 };
    case Direction.Down:
      return { dx: 0, dy: -1 };
    case Direction.Left:
      return { dx: -1, dy: 0 };
    case Direction.Right:
      return { dx: 1, dy: 0 };
  }
}

/** Sprite rotation in radians (sprites are drawn facing up) */
export function rotation(d: Direction): number {
  switch (d) {
    case Direction.Up:
      return 0;
    case Direction.Down:
      return Math.PI;
    case Direction.Left:
      return Math.PI / 2;
    case Direction.Right:
      return -Math.PI / 2;
  }
}

export function opposite(d: Direction): Direction {
  switch (d) {
    case Direction.Up:
      return Direction.Down;
    case Direction.Down:
      return Direction.Up;
    case Direction.Left:
      return Direction.Right;
    case Direction.Right:
      return Direction.Left;
  }
}

/** The direction 90° to the left */
export function turnedLeft(d: Direction): Direction {
  switch (d) {
    case Direction.Up:
      return Direction.Left;
    case Direction.Left:
      return Direction.Down;
    case Direction.Down:
      return Direction.Right;
    case Direction.Right:
      return Direction.Up;
  }
}

export function turnedRight(d: Direction): Direction {
  return opposite(turnedLeft(d));
}

export function randomDirection(): Direction {
  return ALL_DIRECTIONS[Math.floor(Math.random() * 4)];
}
