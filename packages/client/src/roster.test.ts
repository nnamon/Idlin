import { type Actor, createWorld, goodId, spawnsNearCamp, step, type World } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedPrograms, shippedWorld } from "../../sim/src/testing.ts";
import { castOf } from "./cast.ts";
import { NO_FIGHT } from "./fight.ts";
import {
  CHANGE_TICKS,
  type Changes,
  markAt,
  NO_CHANGES,
  nextChanges,
  pickListed,
  totalLevel,
} from "./roster.ts";

const atlas = shippedWorld();

function world(residents: number): World {
  const made = createWorld(atlas, 1, shippedPrograms(atlas));
  step(made, spawnsNearCamp(made, castOf(residents)));
  return made;
}

/** Observes `w` once more after `change` is made to it, one tick on. */
function after(changes: Changes, w: World, change: () => void, fight = NO_FIGHT): Changes {
  w.tick++;
  change();
  return nextChanges(changes, w, fight);
}

describe("a row's change mark", () => {
  it("marks a row hurt, levelled, banking, dying or killing, and nothing else", () => {
    const w = world(6);
    const [ash, birch, cedar, dara, elm, fen] = w.actors as Actor[] as [
      Actor,
      Actor,
      Actor,
      Actor,
      Actor,
      Actor,
    ];
    let changes = nextChanges(NO_CHANGES, w, NO_FIGHT);
    // Nothing is marked on the first look.
    expect(changes.at.size).toBe(0);
    changes = after(changes, w, () => {
      ash.hp -= 3;
      birch.xp[2] = 100_000;
      cedar.bank[goodId("logs") - 1] = 4;
      dara.deaths = 1;
    });
    const kill = { ...NO_FIGHT, news: [{ text: `${elm.name} killed a wolf`, who: elm.id }] };
    expect([...changes.at.keys()].sort()).toEqual([ash.id, birch.id, cedar.id, dara.id].sort());
    const marked = changes.at.get(ash.id);
    // Healing, a full bag and walking about are not changes; a kill is.
    changes = after(
      changes,
      w,
      () => {
        ash.hp += 3;
        fen.bag[0] = goodId("raw_fish");
        fen.x += 1;
      },
      kill,
    );
    expect(changes.at.get(ash.id)).toBe(marked);
    expect(changes.at.has(fen.id)).toBe(false);
    expect(changes.at.get(elm.id)).toBe(w.tick);
  });

  it("is drawn in full for four seconds, then fades out over the fifth", () => {
    const changes: Changes = { tick: 100, seen: new Map(), at: new Map([[1, 100]]) };
    expect(markAt(changes, 1, 100)).toBe(1);
    expect(markAt(changes, 1, 100 + CHANGE_TICKS - 10)).toBe(1);
    expect(markAt(changes, 1, 100 + CHANGE_TICKS - 5)).toBeCloseTo(0.5);
    expect(markAt(changes, 1, 100 + CHANGE_TICKS)).toBe(0);
    expect(markAt(changes, 2, 100)).toBe(0);
  });

  it("starts again with nothing marked when time goes back", () => {
    const w = world(3);
    let changes = nextChanges(NO_CHANGES, w, NO_FIGHT);
    changes = after(changes, w, () => {
      (w.actors[0] as Actor).hp -= 1;
    });
    expect(changes.at.size).toBe(1);
    w.tick -= 50;
    expect(nextChanges(changes, w, NO_FIGHT).at.size).toBe(0);
  });
});

describe("whom the page lists", () => {
  it("lists everyone who fits, in id order", () => {
    const w = world(20);
    expect(pickListed(w.actors, new Map(), 20)).toEqual(w.actors.map((a) => a.id));
  });

  it("past the rows, lists those whose rows changed most lately, still in id order", () => {
    const w = world(25);
    const ids = w.actors.map((a) => a.id);
    // Nobody has changed: the first twenty.
    expect(pickListed(w.actors, new Map(), 20)).toEqual(ids.slice(0, 20));
    // The last three changed lately and come in; the three of the first twenty
    // changed longest ago go out, and the order stays by id.
    const at = new Map(ids.map((id, i) => [id, i < 3 ? 5 : i >= 22 ? 900 : 100]));
    const listed = pickListed(w.actors, at, 20);
    expect(listed).toHaveLength(20);
    expect(listed).toEqual([...ids.slice(3, 20), ...ids.slice(22)]);
  });
});

describe("the number on a row", () => {
  it("is the sum of the resident's levels", () => {
    const [ash] = world(1).actors as [Actor];
    expect(totalLevel(ash)).toBe(5);
    // Melee 10 and Cooking 99.
    ash.xp = [1_154, 0, 0, 0, 13_034_431];
    expect(totalLevel(ash)).toBe(10 + 1 + 1 + 1 + 99);
  });
});
