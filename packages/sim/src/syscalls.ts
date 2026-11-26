// The interface between a program and the world: sensors read, actions do.
// A program refers to a system call by number, so numbers are permanent.
// Append new calls at the end; never renumber, reuse or remove one.

export interface Syscall {
  readonly id: number;
  readonly name: string;
  readonly kind: "sensor" | "action";
  /** How many values the call takes from the stack. */
  readonly args: number;
  readonly about: string;
}

export const SYSCALLS: readonly Syscall[] = [
  {
    id: 0,
    name: "self_x",
    kind: "sensor",
    args: 0,
    about: "The tile column this actor stands on.",
  },
  { id: 1, name: "self_y", kind: "sensor", args: 0, about: "The tile row this actor stands on." },
  { id: 2, name: "hour", kind: "sensor", args: 0, about: "The game hour, 0 to 23." },
  { id: 3, name: "minute", kind: "sensor", args: 0, about: "The game minute, 0 to 59." },
  {
    id: 4,
    name: "walkable",
    kind: "sensor",
    args: 2,
    about: "1 if tile (x, y) can be walked on, else 0.",
  },
  {
    id: 5,
    name: "distance",
    kind: "sensor",
    args: 2,
    about: "Steps in a straight grid line from here to (x, y).",
  },
  { id: 6, name: "idle", kind: "action", args: 0, about: "Do nothing for a moment." },
  {
    id: 7,
    name: "wait",
    kind: "action",
    args: 1,
    about: "Do nothing for the given number of ticks (1 to 600).",
  },
  {
    id: 8,
    name: "walk_to",
    kind: "action",
    args: 2,
    about: "Walk to tile (x, y) by the shortest way.",
  },
  {
    id: 9,
    name: "wander",
    kind: "action",
    args: 0,
    about: "Walk to a walkable tile chosen at random.",
  },
];

export const syscall = (id: number): Syscall | undefined => SYSCALLS[id];
