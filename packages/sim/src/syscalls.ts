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
    about: "Do nothing for the given number of ticks (5 to 600).",
  },
  {
    id: 8,
    name: "walk_to",
    kind: "action",
    args: 2,
    about:
      "Walk to tile (x, y), round anyone in the way; if it is taken or cut off, as near as possible.",
  },
  {
    id: 9,
    name: "wander",
    kind: "action",
    args: 0,
    about: "Walk to a walkable tile chosen at random.",
  },
  { id: 10, name: "hp", kind: "sensor", args: 0, about: "This actor's hitpoints." },
  {
    id: 11,
    name: "max_hp",
    kind: "sensor",
    args: 0,
    about: "The most hitpoints this actor can have.",
  },
  {
    id: 12,
    name: "threat_x",
    kind: "sensor",
    args: 0,
    about: "The column of the nearest enemy, or this actor's own if there is none.",
  },
  {
    id: 13,
    name: "threat_y",
    kind: "sensor",
    args: 0,
    about: "The row of the nearest enemy, or this actor's own if there is none.",
  },
  {
    id: 14,
    name: "threat_distance",
    kind: "sensor",
    args: 0,
    about: "Steps in a straight grid line to the nearest enemy, or 9999 if there is none.",
  },
  {
    id: 15,
    name: "threat_hp",
    kind: "sensor",
    args: 0,
    about: "The nearest enemy's hitpoints, or 0 if there is none.",
  },
  {
    id: 16,
    name: "danger",
    kind: "sensor",
    args: 2,
    about: "Ticks until an enemy's attack lands on tile (x, y), or 0 if none is coming.",
  },
  {
    id: 17,
    name: "danger_here",
    kind: "sensor",
    args: 0,
    about: "Ticks until an enemy's attack lands where this actor stands, or 0.",
  },
  {
    id: 18,
    name: "attack",
    kind: "action",
    args: 2,
    about: "Wind up and strike in a line out from this actor, in the direction of (x, y).",
  },
  {
    id: 19,
    name: "step_clear",
    kind: "action",
    args: 0,
    about:
      "Walk to the nearest tile no enemy attack is about to land on; an ally may be standing there.",
  },
  {
    id: 20,
    name: "flee",
    kind: "action",
    args: 2,
    about:
      "Walk up to three tiles along the way that leads farthest from (x, y); five if it has to go round something that steps into the way and blocks it (a monster for an adventurer, an adventurer for a monster).",
  },
  {
    id: 21,
    name: "threat_recovering",
    kind: "sensor",
    args: 0,
    about:
      "Ticks after this one that the nearest enemy still needs to get its balance back after its last blow: 0 if it can act on the next tick, or if there is no enemy.",
  },
  {
    id: 22,
    name: "step_to",
    kind: "action",
    args: 2,
    about: "Take the first step of the way `walk_to` would go to tile (x, y).",
  },
  {
    id: 23,
    name: "stalled",
    kind: "sensor",
    args: 0,
    about:
      "How many decisions in a row, up to 1000, chose to move (`walk_to`, `wander`, `step_clear`, `flee` or `step_to`) and found nowhere to go. 0 after any other decision.",
  },
];

export const syscall = (id: number): Syscall | undefined => SYSCALLS[id];
