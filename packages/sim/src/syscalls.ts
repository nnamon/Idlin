// The interface between a program and the world: sensors read, actions do.
// A program refers to a system call by number, so numbers are permanent.
// Append new calls at the end; never renumber, reuse or remove one. A call
// that no longer does anything is `retired`: it keeps its number, and the
// compiler and the machine refuse it.

export interface Syscall {
  readonly id: number;
  readonly name: string;
  readonly kind: "sensor" | "action";
  /** How many values the call takes from the stack. */
  readonly args: number;
  readonly about: string;
  /** Why a call is retired, if it is. */
  readonly retired?: string;
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
  {
    id: 2,
    name: "hour",
    kind: "sensor",
    args: 0,
    about: "Retired: the camp's game hour.",
    retired:
      "there is no game hour: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
  {
    id: 3,
    name: "minute",
    kind: "sensor",
    args: 0,
    about: "Retired: the camp's game minute.",
    retired:
      "there is no game hour: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
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
      "Walk to tile (x, y), round anyone in the way; if it is taken or cut off, as near as possible. A way round more than 8 steps longer is taken only after a move got nowhere (`stalled` above 0).",
  },
  {
    id: 9,
    name: "wander",
    kind: "action",
    args: 0,
    about:
      "Walk to a walkable tile chosen at random on the ground this actor stands on. A resident stops on the free tile nearest it, as `walk_to` does.",
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
    about:
      "Wind up and strike towards (x, y): an adventurer with its weapon, in the nearest of eight directions; a monster in a line up, down, left or right.",
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
    about:
      "Take the first step of the way `walk_to` would go to tile (x, y). On a way round people more than 8 steps longer, take the steps up to where the rest of it is not.",
  },
  {
    id: 23,
    name: "stalled",
    kind: "sensor",
    args: 0,
    about:
      "How many decisions in a row, up to 1000, chose to move (`walk_to`, `wander`, `step_clear`, `flee` or `step_to`) and found nowhere to go. 0 after any other decision.",
  },
  {
    id: 24,
    name: "level",
    kind: "sensor",
    args: 1,
    about:
      "This adventurer's level, 1 to 99, in a skill: `melee`, `hitpoints`, `woodcutting`, `fishing` or `cooking`. 0 for anything else, and for a monster.",
  },
  {
    id: 25,
    name: "xp",
    kind: "sensor",
    args: 1,
    about: "This adventurer's experience in a skill, as for `level`; 0 for anything else.",
  },
  {
    id: 26,
    name: "bag_free",
    kind: "sensor",
    args: 0,
    about: "How many of the bag's 12 slots are empty.",
  },
  {
    id: 27,
    name: "carrying",
    kind: "sensor",
    args: 1,
    about:
      "How many of a good (`logs`, `raw_fish`, `cooked_fish` or `burnt_fish`) are in the bag; 0 for anything else.",
  },
  {
    id: 28,
    name: "banked",
    kind: "sensor",
    args: 1,
    about: "How many of a good are in this adventurer's bank, as for `carrying`.",
  },
  {
    id: 29,
    name: "at_bank",
    kind: "sensor",
    args: 0,
    about:
      "1 if this actor stands next to the bank chest, where it can deposit and withdraw, else 0.",
  },
  {
    id: 30,
    name: "deposit",
    kind: "action",
    args: 2,
    about:
      "At the bank, put up to the given number of a good from the bag into the bank: deposit(logs, 5). Away from it, nothing happens.",
  },
  {
    id: 31,
    name: "withdraw",
    kind: "action",
    args: 2,
    about:
      "At the bank, take up to the given number of a good out of the bank, as many as there are empty slots for.",
  },
  {
    id: 32,
    name: "bank_all",
    kind: "action",
    args: 0,
    about: "At the bank, put everything in the bag into the bank.",
  },
  {
    id: 33,
    name: "node_distance",
    kind: "sensor",
    args: 1,
    about:
      "Steps in a straight grid line to the nearest free tile beside a node of a kind (`tree`, `old_tree`, `fishing_spot` or `deep_pool`) that stands and that its level allows: 0 when it is standing on one. 9999 if there is none.",
  },
  {
    id: 34,
    name: "node_x",
    kind: "sensor",
    args: 1,
    about: "The column of the tile `node_distance` measures to, or this actor's own if none.",
  },
  {
    id: 35,
    name: "node_y",
    kind: "sensor",
    args: 1,
    about: "The row of the tile `node_distance` measures to, or this actor's own if none.",
  },
  {
    id: 36,
    name: "chop",
    kind: "action",
    args: 0,
    about:
      "Beside a tree this adventurer may cut, try for a log, then stand for 12 ticks. Without one, or with a full bag, nothing happens.",
  },
  {
    id: 37,
    name: "fish",
    kind: "action",
    args: 0,
    about: "Beside a fishing spot this adventurer may fish, try for a raw fish, as `chop` does.",
  },
  {
    id: 38,
    name: "at_fire",
    kind: "sensor",
    args: 0,
    about: "1 if this actor stands within two steps of a campfire tile, where it can cook, else 0.",
  },
  {
    id: 39,
    name: "cook",
    kind: "action",
    args: 0,
    about:
      "At the fire, cook a raw fish from the bag over a log from the bag, then stand for 18 ticks. The log burns up and the fish comes out cooked, or burnt.",
  },
  {
    id: 40,
    name: "eat",
    kind: "action",
    args: 0,
    about:
      "Eat a cooked fish from the bag for up to 6 hitpoints. At full hitpoints, or with none, nothing happens.",
  },
  {
    id: 41,
    name: "threat_friends",
    kind: "sensor",
    args: 0,
    about:
      "How many of the nearest enemy's own kind stand within 4 steps of it, not counting itself; 0 if there is no enemy.",
  },
  {
    id: 42,
    name: "friends_near",
    kind: "sensor",
    args: 1,
    about:
      "How many of this actor's own kind (citizens, or monsters of its kind), not counting itself or citizens mending after a down, stand within the given number of steps of it; 0 below 0.",
  },
  {
    id: 43,
    name: "lit_here",
    kind: "sensor",
    args: 0,
    about: "Retired: whether this actor stood in the camp's firelight.",
    retired:
      "there is no firelight: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
  {
    id: 44,
    name: "threat_lit",
    kind: "sensor",
    args: 0,
    about: "Retired: whether the nearest enemy stood in the camp's firelight.",
    retired:
      "there is no firelight: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
  {
    id: 45,
    name: "threat_moving",
    kind: "sensor",
    args: 0,
    about:
      "1 if the nearest enemy is walking (partway through a step, or with more of a walk ahead of it), else 0, and 0 if there is none.",
  },
  {
    id: 46,
    name: "lit_enemies",
    kind: "sensor",
    args: 0,
    about: "Retired: how many of this actor's enemies stood in the camp's firelight.",
    retired:
      "there is no firelight: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
  {
    id: 47,
    name: "lit_mending",
    kind: "sensor",
    args: 0,
    about: "Retired: how many citizens lay mending in the camp's firelight.",
    retired:
      "there is no firelight: the camp's clock and firelight went with the camp world (docs/slice.md, section 10)",
  },
  {
    id: 48,
    name: "weapon_reach",
    kind: "sensor",
    args: 0,
    about:
      "How many steps out this actor's blow reaches, counting a diagonal step as one: 2 with a blade, 3 with a maul, 4 with a spear, 9 with a bow, and a monster's reach.",
  },
  {
    id: 49,
    name: "flask",
    kind: "sensor",
    args: 0,
    about: "Drinks left in this actor's flask, 0 to 3; always 0 for a monster.",
  },
  {
    id: 50,
    name: "drink",
    kind: "action",
    args: 0,
    about:
      "Drink from the flask for 40% of the most hitpoints this actor can have. At full hitpoints, or with the flask empty, nothing happens.",
  },
  {
    id: 51,
    name: "flagged",
    kind: "sensor",
    args: 0,
    about:
      "What this citizen's flag is on, as its chatter planted it with `!go`: 0 with no flag, 1 for a tile, 2 for a citizen, 3 for home.",
  },
  {
    id: 52,
    name: "flag_x",
    kind: "sensor",
    args: 0,
    about:
      "The column of the flag, or this actor's own with no flag. `flag` stands for the flag's place: `walk_to(flag)`.",
  },
  {
    id: 53,
    name: "flag_y",
    kind: "sensor",
    args: 0,
    about: "The row of the flag, or this actor's own with no flag.",
  },
  {
    id: 54,
    name: "flag_age",
    kind: "sensor",
    args: 0,
    about: "Ticks since the flag was planted, or 0 with no flag.",
  },
  {
    id: 55,
    name: "flag_down",
    kind: "sensor",
    args: 0,
    about: "1 if the flag is on a citizen who is down, else 0.",
  },
  {
    id: 56,
    name: "heard",
    kind: "sensor",
    args: 0,
    about: "Ticks since this citizen's chatter last typed anything, up to 864000.",
  },
  {
    id: 57,
    name: "lift_eta",
    kind: "sensor",
    args: 0,
    about:
      "Ticks until lift-off, or 9999 before the front is sighted. Until the shield is built (slice piece 31) it counts as if the shield broke the moment the front reached the bubble: the ticks to the siege and 300 more, and during the siege 300; from the break, the ticks to lift-off. On a world of one map, 9999.",
  },
  {
    id: 58,
    name: "way_home",
    kind: "sensor",
    args: 0,
    about:
      "Ticks the walk home takes from here: to the hold on the city's deck, or to `camp` on a world of one map that has one. 9999 if there is no way.",
  },
];

export const syscall = (id: number): Syscall | undefined => SYSCALLS[id];
