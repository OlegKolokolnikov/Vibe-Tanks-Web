import type { Color } from "./color";
import type { Node } from "./node";
import type { Point } from "./geometry";

export type TimingMode = "linear" | "easeIn" | "easeOut" | "easeInEaseOut";

function ease(mode: TimingMode, t: number): number {
  switch (mode) {
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInEaseOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

/** A running action. `step` returns the unused time once finished, or -1 while still running. */
export interface ActionRun {
  step(dt: number): number;
}

/**
 * Reusable action description (like SKAction). Running it on a node creates fresh state,
 * so one action can be run on many nodes, or many times.
 */
export abstract class Action {
  timingMode: TimingMode = "linear";

  constructor(public duration: number) {}

  abstract start(node: Node): ActionRun;

  ease(mode: TimingMode): this {
    this.timingMode = mode;
    return this;
  }

  // MARK: Factories

  static moveBy(dx: number, dy: number, duration: number): Action {
    return new Tween(duration, (node) => (p, prev) => {
      node.position.x += dx * (p - prev);
      node.position.y += dy * (p - prev);
    });
  }

  static moveTo(target: Partial<Point>, duration: number): Action {
    return new Tween(duration, (node) => {
      const sx = node.position.x;
      const sy = node.position.y;
      return (p) => {
        if (target.x !== undefined) node.position.x = sx + (target.x - sx) * p;
        if (target.y !== undefined) node.position.y = sy + (target.y - sy) * p;
      };
    });
  }

  static moveToX(x: number, duration: number): Action {
    return Action.moveTo({ x }, duration);
  }

  static moveToY(y: number, duration: number): Action {
    return Action.moveTo({ y }, duration);
  }

  static scaleTo(scale: number, duration: number): Action {
    return Action.scaleXYTo(scale, scale, duration);
  }

  static scaleXYTo(x: number | undefined, y: number | undefined, duration: number): Action {
    return new Tween(duration, (node) => {
      const sx = node.xScale;
      const sy = node.yScale;
      return (p) => {
        if (x !== undefined) node.xScale = sx + (x - sx) * p;
        if (y !== undefined) node.yScale = sy + (y - sy) * p;
      };
    });
  }

  static scaleYTo(y: number, duration: number): Action {
    return Action.scaleXYTo(undefined, y, duration);
  }

  static rotateBy(angle: number, duration: number): Action {
    return new Tween(duration, (node) => (p, prev) => {
      node.zRotation += angle * (p - prev);
    });
  }

  static rotateTo(angle: number, duration: number): Action {
    return new Tween(duration, (node) => {
      const start = node.zRotation;
      return (p) => {
        node.zRotation = start + (angle - start) * p;
      };
    });
  }

  static fadeAlpha(to: number, duration: number): Action {
    return new Tween(duration, (node) => {
      const start = node.alpha;
      return (p) => {
        node.alpha = start + (to - start) * p;
      };
    });
  }

  static fadeIn(duration: number): Action {
    return Action.fadeAlpha(1, duration);
  }

  static fadeOut(duration: number): Action {
    return Action.fadeAlpha(0, duration);
  }

  /** Tint toward a color (sprites) */
  static colorize(color: Color | null, factor: number, duration: number): Action {
    return new Tween(duration, (node) => {
      if (color) node.blendColor = color;
      const start = node.colorBlendFactor;
      return (p) => {
        node.colorBlendFactor = start + (factor - start) * p;
      };
    });
  }

  /** Move along a quadratic curve (start, control point, end) */
  static followQuad(start: Point, control: Point, end: Point, duration: number): Action {
    return new Tween(duration, (node) => (p) => {
      const q = 1 - p;
      node.position.x = q * q * start.x + 2 * q * p * control.x + p * p * end.x;
      node.position.y = q * q * start.y + 2 * q * p * control.y + p * p * end.y;
    });
  }

  static wait(duration: number): Action {
    return new Tween(duration, () => () => {});
  }

  static run(block: () => void): Action {
    return new Instant(() => block());
  }

  static removeFromParent(): Action {
    return new Instant((node) => node.removeFromParent());
  }

  static sequence(actions: Action[]): Action {
    return new Sequence(actions);
  }

  static group(actions: Action[]): Action {
    return new Group(actions);
  }

  static repeat(action: Action, count: number): Action {
    return new Repeat(action, count);
  }

  static repeatForever(action: Action): Action {
    return new Repeat(action, Infinity);
  }
}

class Tween extends Action {
  constructor(
    duration: number,
    private readonly setup: (node: Node) => (progress: number, previous: number) => void,
  ) {
    super(duration);
  }

  start(node: Node): ActionRun {
    let apply: ((p: number, prev: number) => void) | null = null;
    let elapsed = 0;
    let previous = 0;
    const duration = this.duration;
    const mode = this.timingMode;
    return {
      step: (dt) => {
        if (!apply) apply = this.setup(node);
        elapsed += dt;
        const t = duration <= 0 ? 1 : Math.min(elapsed / duration, 1);
        const p = ease(mode, t);
        apply(p, previous);
        previous = p;
        return t >= 1 ? Math.max(elapsed - duration, 0) : -1;
      },
    };
  }
}

class Instant extends Action {
  constructor(private readonly block: (node: Node) => void) {
    super(0);
  }

  start(node: Node): ActionRun {
    return {
      step: (dt) => {
        this.block(node);
        return dt;
      },
    };
  }
}

class Sequence extends Action {
  constructor(private readonly actions: Action[]) {
    super(actions.reduce((sum, a) => sum + a.duration, 0));
  }

  start(node: Node): ActionRun {
    let index = 0;
    let current: ActionRun | null = null;
    return {
      step: (dt) => {
        while (index < this.actions.length) {
          if (!current) current = this.actions[index].start(node);
          const left = current.step(dt);
          if (left < 0) return -1;
          dt = left;
          index++;
          current = null;
        }
        return dt;
      },
    };
  }
}

class Group extends Action {
  constructor(private readonly actions: Action[]) {
    super(Math.max(0, ...actions.map((a) => a.duration)));
  }

  start(node: Node): ActionRun {
    const runs: (ActionRun | null)[] = this.actions.map((a) => a.start(node));
    return {
      step: (dt) => {
        let leftover = dt;
        let running = false;
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i];
          if (!run) continue;
          const left = run.step(dt);
          if (left < 0) {
            running = true;
          } else {
            runs[i] = null;
            leftover = Math.min(leftover, left);
          }
        }
        return running ? -1 : leftover;
      },
    };
  }
}

class Repeat extends Action {
  constructor(
    private readonly action: Action,
    private readonly count: number,
  ) {
    super(action.duration * count);
  }

  start(node: Node): ActionRun {
    let done = 0;
    let current: ActionRun | null = null;
    return {
      step: (dt) => {
        while (done < this.count) {
          if (!current) current = this.action.start(node);
          const before = dt;
          const left = current.step(dt);
          if (left < 0) return -1;
          current = null;
          done++;
          dt = left;
          // An instant cycle of a forever-repeat runs once per frame
          if (this.count === Infinity && left >= before) return -1;
        }
        return dt;
      },
    };
  }
}
