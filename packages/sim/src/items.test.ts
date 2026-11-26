import { describe, expect, it } from "vitest";
import {
  type Affix,
  type Item,
  ItemError,
  type ItemTable,
  itemName,
  itemStats,
  loadItems,
  MAX_ITEM_LEVEL,
  RARITIES,
  type Rarity,
  rollItem,
} from "./items.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";
import { rawItems, shippedItems } from "./testing.ts";

const ITEMS = shippedItems();
const LEVELS = [1, 5, 10, 20, 50, MAX_ITEM_LEVEL];
// The full sweeps run in the capture workflow; the gate runs a sample of each.
const LONG = process.env.IDLIN_LONG === "1";

const affixOf = (table: ItemTable, id: string): Affix => {
  const affix = table.affixes.find((a) => a.id === id);
  if (!affix) throw new Error(`no affix ${id}`);
  return affix;
};

const rollMany = (table: ItemTable, base: string, level: number, count: number, seed = 1) => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rollItem(table, base, level, rng));
};

/** Plain content to build test tables from: one base per slot, a few affixes. */
const small = () => ({
  rarities: {
    normal: { weight: 1, prefixes: 0, suffixes: 0, min: 0, max: 0 },
    magic: { weight: 1, prefixes: 1, suffixes: 1, min: 1, max: 2 },
    rare: { weight: 1, prefixes: 2, suffixes: 2, min: 2, max: 4 },
  },
  bases: { stick: { name: "Stick", slot: "weapon", level: 1, stats: { damage: 2 } } },
  affixes: {
    sharp: {
      name: "Sharp",
      kind: "prefix",
      group: "flat",
      stat: "damage",
      slots: ["weapon"],
      weight: 1,
      tiers: [{ level: 1, min: 1, max: 1 }],
    },
    keen: {
      name: "Keen",
      kind: "prefix",
      group: "flat",
      stat: "damage",
      slots: ["weapon"],
      weight: 1,
      tiers: [{ level: 1, min: 2, max: 2 }],
    },
    cruel: {
      name: "Cruel",
      kind: "prefix",
      group: "pct",
      stat: "damage_pct",
      slots: ["weapon"],
      weight: 1,
      tiers: [{ level: 1, min: 10, max: 10 }],
    },
    aim: {
      name: "of Aim",
      kind: "suffix",
      group: "aim",
      stat: "accuracy",
      slots: ["weapon"],
      weight: 1,
      tiers: [{ level: 1, min: 5, max: 5 }],
    },
  } as Record<string, unknown>,
});

type Content = ReturnType<typeof small>;
/** A fresh copy of the small content with `change` made to it. */
const tweak = (change: (c: Content) => void): Content => {
  const c = structuredClone(small());
  change(c);
  return c;
};
const sharp = (c: Content) => c.affixes.sharp as Record<string, unknown>;

describe("loadItems", () => {
  it("loads the shipped items: four slots, three rarities, affixes in a fixed order", () => {
    const slots = new Set(Object.values(ITEMS.bases).map((b) => b.slot));
    expect([...slots].sort()).toEqual(["body", "helm", "ring", "weapon"]);
    expect(Object.keys(ITEMS.rarities)).toEqual(["normal", "magic", "rare"]);
    const ids = ITEMS.affixes.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    expect(Object.isFrozen(ITEMS) && Object.isFrozen(ITEMS.affixes[0]?.tiers)).toBe(true);
  });

  it("does not depend on the order of the file", () => {
    const raw = rawItems();
    const reversed = Object.fromEntries(Object.entries(raw.affixes as object).reverse());
    const other = loadItems({ ...raw, affixes: reversed });
    expect(rollMany(other, "hand_axe", 40, 200)).toEqual(rollMany(ITEMS, "hand_axe", 40, 200));
  });

  const rejects: [string, unknown, RegExp][] = [
    ["something that is not an object", "items", /item content must be an object/],
    ["no rarities", { ...small(), rarities: undefined }, /rarities must be an object/],
    [
      "an extra rarity",
      tweak((c) => Object.assign(c.rarities, { unique: c.rarities.rare })),
      /rarities has an unknown field "unique"/,
    ],
    [
      "a missing rarity",
      tweak((c) => Reflect.deleteProperty(c.rarities, "magic")),
      /rarity "magic" must be an object/,
    ],
    [
      "a fractional weight",
      tweak((c) => Object.assign(c.rarities.magic, { weight: 1.5 })),
      /rarity "magic": weight must be a whole number from 0 to 10000, got 1.5/,
    ],
    [
      "more affixes than a rarity has room for",
      tweak((c) => Object.assign(c.rarities.rare, { max: 5 })),
      /rarity "rare": max is more than prefixes and suffixes together/,
    ],
    [
      "min above max",
      tweak((c) => Object.assign(c.rarities.rare, { min: 4, max: 3 })),
      /rarity "rare": min is more than max/,
    ],
    [
      "every rarity weighing nothing",
      tweak((c) => {
        for (const r of RARITIES) c.rarities[r].weight = 0;
      }),
      /at least one weight must be above 0/,
    ],
    ["no bases", tweak((c) => Object.assign(c, { bases: {} })), /bases is empty/],
    [
      "a base id that is not plain",
      tweak((c) => Object.assign(c.bases, { "Big Stick": c.bases.stick })),
      /"Big Stick" in bases is not a valid id/,
    ],
    [
      "a base in an unknown slot",
      tweak((c) => Object.assign(c.bases.stick, { slot: "boots" })),
      /base "stick": slot must be one of weapon, body, helm, ring, got "boots"/,
    ],
    [
      "a base with no name",
      tweak((c) => Object.assign(c.bases.stick, { name: "" })),
      /base "stick" needs a name/,
    ],
    [
      "a name a viewer cannot read",
      tweak((c) => Object.assign(c.bases.stick, { name: "<b>Stick</b>" })),
      /base "stick" needs a name/,
    ],
    [
      "a base above the highest item level",
      tweak((c) => Object.assign(c.bases.stick, { level: 101 })),
      /base "stick": level must be a whole number from 1 to 100/,
    ],
    [
      "an unknown stat",
      tweak((c) => Object.assign(c.bases.stick.stats, { mana: 3 })),
      /base "stick": stats has an unknown field "mana"/,
    ],
    [
      "a negative stat",
      tweak((c) => Object.assign(c.bases.stick.stats, { damage: -1 })),
      /base "stick": damage must be a whole number from 0 to 10000, got -1/,
    ],
    [
      "a misspelt field",
      tweak((c) => Object.assign(sharp(c), { wieght: 1 })),
      /affix "sharp" has an unknown field "wieght"/,
    ],
    [
      "a kind other than prefix or suffix",
      tweak((c) => Object.assign(sharp(c), { kind: "infix" })),
      /affix "sharp": kind must be one of prefix, suffix/,
    ],
    [
      "a group that is not an id",
      tweak((c) => Object.assign(sharp(c), { group: 7 })),
      /affix "sharp": group must be an id/,
    ],
    [
      "an affix that rolls on no slot",
      tweak((c) => Object.assign(sharp(c), { slots: [] })),
      /affix "sharp": slots must be a list of 1 to 4 entries, got 0/,
    ],
    [
      "more slots than there are",
      tweak((c) => Object.assign(sharp(c), { slots: ["weapon", "body", "helm", "ring", "ring"] })),
      /affix "sharp": slots must be a list of 1 to 4 entries, got 5/,
    ],
    [
      "slots that are not a list",
      tweak((c) => Object.assign(sharp(c), { slots: { 0: "weapon", length: 1 } })),
      /affix "sharp": slots must be a list of 1 to 4 entries$/,
    ],
    [
      "a sparse list of slots",
      // biome-ignore lint/suspicious/noSparseArray: the hole is what is being tested.
      tweak((c) => Object.assign(sharp(c), { slots: [, "weapon"] })),
      /affix "sharp": slots has a gap at 0/,
    ],
    [
      "a list of slots with an absurd length",
      tweak((c) => {
        const slots: unknown[] = ["weapon"];
        slots.length = 2 ** 32 - 1;
        Object.assign(sharp(c), { slots });
      }),
      /affix "sharp": slots must be a list of 1 to 4 entries, got 4294967295/,
    ],
    [
      "more tiers than the cap",
      tweak((c) =>
        Object.assign(sharp(c), {
          tiers: Array.from({ length: 11 }, (_, i) => ({ level: i + 1, min: 1, max: 1 })),
        }),
      ),
      /affix "sharp": tiers must be a list of 1 to 10 entries, got 11/,
    ],
    [
      "a slot listed twice",
      tweak((c) => Object.assign(sharp(c), { slots: ["weapon", "weapon"] })),
      /affix "sharp": a slot is listed twice/,
    ],
    [
      "an affix that never rolls",
      tweak((c) => Object.assign(sharp(c), { weight: 0 })),
      /affix "sharp": weight must be a whole number from 1/,
    ],
    [
      "no tiers",
      tweak((c) => Object.assign(sharp(c), { tiers: [] })),
      /affix "sharp": tiers must be a list of 1 to 10 entries, got 0/,
    ],
    [
      "tiers out of order",
      tweak((c) =>
        Object.assign(sharp(c), {
          tiers: [
            { level: 5, min: 1, max: 2 },
            { level: 5, min: 3, max: 4 },
          ],
        }),
      ),
      /affix "sharp": tier 1: levels must go up/,
    ],
    [
      "a tier whose range is backwards",
      tweak((c) => Object.assign(sharp(c), { tiers: [{ level: 1, min: 3, max: 2 }] })),
      /affix "sharp": tier 0: min is more than max/,
    ],
    [
      "a tier that is not an object",
      tweak((c) => Object.assign(sharp(c), { tiers: [3] })),
      /affix "sharp": tier 0 must be an object/,
    ],
    [
      "a prototype key",
      tweak((c) => Object.assign(c, { affixes: JSON.parse('{"__proto__": {}}') })),
      /"__proto__" in affixes is not a valid id/,
    ],
  ];

  for (const [what, content, message] of rejects) {
    it(`refuses ${what}`, () => {
      const load = () => loadItems(content as Parameters<typeof loadItems>[0]);
      expect(load).toThrow(ItemError);
      expect(load).toThrow(message);
    });
  }

  it("refuses a table where only one affix of many is bad, rather than loading the rest", () => {
    const content = tweak((c) => Object.assign(c.affixes, { zzz: { name: "Broken" } }));
    expect(() => loadItems(content)).toThrow(/affix "zzz"/);
    expect(() => loadItems(small())).not.toThrow();
  });

  it("turns content that throws when read into an ItemError", () => {
    const trap = new Proxy(
      {},
      {
        get: () => {
          throw new Error("boom");
        },
        ownKeys: () => {
          throw new Error("boom");
        },
      },
    );
    for (const content of [trap, { ...small(), bases: trap }, { ...small(), affixes: trap }]) {
      expect(() => loadItems(content as Parameters<typeof loadItems>[0])).toThrow(
        /could not be read/,
      );
    }
    const getter = tweak((c) =>
      Object.defineProperty(c.bases.stick, "level", {
        enumerable: true,
        get: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(() => loadItems(getter)).toThrow(ItemError);
  });

  it("reads a list once, so a list that changes while it is read cannot get past the checks", () => {
    // The length grows by one every time it is read: a check of the length and
    // a later loop over it would see different lists.
    const growing = (first: unknown[], extra: unknown) => {
      let reads = 0;
      return new Proxy(first, {
        get: (target, key) => {
          if (key === "length") return target.length + reads++;
          return Reflect.get(target, key) ?? extra;
        },
      });
    };
    const content = tweak((c) =>
      Object.assign(sharp(c), {
        tiers: growing([{ level: 1, min: 1, max: 1 }], { level: 1, min: 9999, max: 1 }),
        slots: growing(["weapon"], "boots"),
      }),
    );
    const table = loadItems(content);
    expect(affixOf(table, "sharp").tiers).toEqual([{ level: 1, min: 1, max: 1 }]);
    expect(affixOf(table, "sharp").slots).toEqual(["weapon"]);
    expect(Array.isArray(affixOf(table, "sharp").tiers)).toBe(true);
  });

  it("stores -0 as 0", () => {
    const table = loadItems(
      tweak((c) => {
        Object.assign(sharp(c), { tiers: [{ level: 1, min: -0, max: -0 }] });
        Object.assign(c.bases.stick.stats, { damage: -0 });
        Object.assign(c.rarities.normal, { weight: -0 });
      }),
    );
    const tier = affixOf(table, "sharp").tiers[0];
    expect(Object.is(tier?.min, 0) && Object.is(tier?.max, 0)).toBe(true);
    expect(Object.is(table.bases.stick?.stats.damage, 0)).toBe(true);
    expect(Object.is(table.rarities.normal.weight, 0)).toBe(true);
  });

  it("never lets garbage content throw anything but an ItemError, and what loads can roll", {
    timeout: 60_000,
  }, () => {
    const garbage: unknown[] = [
      null,
      undefined,
      -1,
      0,
      1.5,
      2 ** 40,
      Number.NaN,
      "",
      "x",
      "weapon",
      [],
      {},
      [1],
      true,
      { level: 1, min: 0, max: 0 },
    ];
    const rng = createRng(99);
    let loaded = 0;
    const runs = LONG ? 500 : 100;
    for (let n = 0; n < runs; n++) {
      const content: Record<string, unknown> = structuredClone(rawItems());
      // Replace one value, at any depth, with something hostile.
      let node: Record<string, unknown> = content;
      for (;;) {
        const keys = Object.keys(node);
        const key = keys[nextInt(rng, keys.length)] as string;
        const child = node[key];
        const leaf = typeof child !== "object" || child === null || Object.keys(child).length === 0;
        if (leaf || nextInt(rng, 4) === 0) {
          node[key] = garbage[nextInt(rng, garbage.length)];
          break;
        }
        node = child as Record<string, unknown>;
      }
      let table: ItemTable;
      try {
        table = loadItems(content as Parameters<typeof loadItems>[0]);
      } catch (error) {
        expect(error).toBeInstanceOf(ItemError);
        continue;
      }
      loaded++;
      for (const base of Object.values(table.bases)) {
        for (const item of rollMany(table, base.id, MAX_ITEM_LEVEL, 5, n)) {
          itemStats(table, item);
          itemName(table, item);
        }
      }
    }
    // Some mutations are harmless (a weight of 0 on a rarity, say), so both paths ran.
    expect(loaded).toBeGreaterThan(0);
    expect(loaded).toBeLessThan(runs);
  });
});

describe("rollItem", () => {
  it("rolls rarities at the rates the content gives, within a percentage point", () => {
    const items = rollMany(ITEMS, "iron_hat", 30, 30_000);
    const total = RARITIES.reduce((sum, r) => sum + ITEMS.rarities[r].weight, 0);
    for (const rarity of RARITIES) {
      const share = items.filter((i) => i.rarity === rarity).length / items.length;
      expect(Math.abs(share - ITEMS.rarities[rarity].weight / total), rarity).toBeLessThan(0.01);
    }
  });

  it("gives each rarity a number of affixes in its range, evenly when the pool allows", () => {
    for (const base of Object.values(ITEMS.bases)) {
      const items = rollMany(ITEMS, base.id, 50, 20_000);
      for (const rarity of RARITIES) {
        const { min, max } = ITEMS.rarities[rarity];
        const counts = new Map<number, number>();
        const ofRarity = items.filter((i) => i.rarity === rarity);
        for (const i of ofRarity) {
          const n = i.prefixes.length + i.suffixes.length;
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        // At level 50 every shipped base has room for the most any rarity asks for.
        expect([...counts.keys()].sort(), `${base.id} ${rarity}`).toEqual(
          Array.from({ length: max - min + 1 }, (_, k) => min + k),
        );
        for (const n of counts.values()) {
          const share = n / ofRarity.length;
          expect(Math.abs(share - 1 / (max - min + 1)), `${base.id} ${rarity}`).toBeLessThan(0.1);
        }
      }
    }
  });

  it("rolls only affixes from the pool for the base's slot, in the right list, with values in range", () => {
    for (const base of Object.values(ITEMS.bases)) {
      for (const level of LEVELS.filter((l) => l >= base.level)) {
        for (const item of rollMany(ITEMS, base.id, level, LONG ? 1000 : 200)) {
          const rule = ITEMS.rarities[item.rarity];
          expect(item.prefixes.length).toBeLessThanOrEqual(rule.prefixes);
          expect(item.suffixes.length).toBeLessThanOrEqual(rule.suffixes);
          for (const [kind, list] of [
            ["prefix", item.prefixes],
            ["suffix", item.suffixes],
          ] as const) {
            for (const rolled of list) {
              const affix = affixOf(ITEMS, rolled.affix);
              expect(affix.kind).toBe(kind);
              expect(affix.slots).toContain(base.slot);
              const tier = affix.tiers[rolled.tier];
              expect(tier).toBeDefined();
              expect(rolled.value).toBeGreaterThanOrEqual(tier?.min ?? 0);
              expect(rolled.value).toBeLessThanOrEqual(tier?.max ?? 0);
            }
          }
        }
      }
    }
  });

  it("never rolls a tier above the item level, and rolls every tier at or below it", () => {
    for (const base of Object.values(ITEMS.bases)) {
      for (const level of LEVELS.filter((l) => l >= base.level)) {
        const seen = new Set<string>();
        for (const item of rollMany(ITEMS, base.id, level, 4000)) {
          for (const rolled of [...item.prefixes, ...item.suffixes]) {
            const tier = affixOf(ITEMS, rolled.affix).tiers[rolled.tier];
            expect(tier?.level, `${base.id} at ${level}`).toBeLessThanOrEqual(level);
            seen.add(`${rolled.affix}/${rolled.tier}`);
          }
        }
        const expected = ITEMS.affixes
          .filter((a) => a.slots.includes(base.slot))
          .flatMap((a) => a.tiers.flatMap((t, i) => (t.level <= level ? [`${a.id}/${i}`] : [])));
        expect([...seen].sort(), `${base.id} at ${level}`).toEqual(expected.sort());
      }
    }
  });

  // Five standard deviations of a binomial count: a correct roll falls outside
  // it about once in two million runs.
  const spread = (n: number, p: number) => 5 * Math.sqrt(n * p * (1 - p));

  it("picks affixes in proportion to their weights", () => {
    // Only magic items with exactly one prefix, from three prefixes of weight
    // 1, 3 and 6 in separate groups.
    const content = tweak((c) => {
      c.rarities.normal.weight = 0;
      c.rarities.rare.weight = 0;
      Object.assign(c.rarities.magic, { suffixes: 0, min: 1, max: 1 });
      Reflect.deleteProperty(c.affixes, "aim");
      Object.assign(sharp(c), { weight: 1 });
      Object.assign(c.affixes.keen as object, { weight: 3, group: "keen" });
      Object.assign(c.affixes.cruel as object, { weight: 6 });
    });
    const table = loadItems(content);
    const n = 20_000;
    const counts = new Map<string, number>();
    for (const item of rollMany(table, "stick", 1, n)) {
      const id = item.prefixes[0]?.affix ?? "none";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["cruel", "keen", "sharp"]);
    for (const [id, weight] of [
      ["sharp", 1],
      ["keen", 3],
      ["cruel", 6],
    ] as const) {
      const p = weight / 10;
      expect(Math.abs((counts.get(id) ?? 0) - n * p), id).toBeLessThan(spread(n, p));
    }
  });

  it("rolls both ends of a tier's range, and every value between", () => {
    const content = tweak((c) => {
      for (const id of ["keen", "cruel", "aim"]) Reflect.deleteProperty(c.affixes, id);
      Object.assign(sharp(c), { tiers: [{ level: 1, min: 3, max: 7 }] });
    });
    const table = loadItems(content);
    const values = new Map<number, number>();
    for (const item of rollMany(table, "stick", 1, 5000)) {
      for (const rolled of item.prefixes)
        values.set(rolled.value, (values.get(rolled.value) ?? 0) + 1);
    }
    expect([...values.keys()].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("chooses evenly among the tiers the item level allows", () => {
    const tiers = [0, 0, 0];
    let n = 0;
    for (const item of rollMany(ITEMS, "long_sword", MAX_ITEM_LEVEL, 40_000)) {
      for (const rolled of item.prefixes) {
        if (rolled.affix !== "added_damage") continue;
        tiers[rolled.tier] = (tiers[rolled.tier] ?? 0) + 1;
        n++;
      }
    }
    for (const count of tiers) expect(Math.abs(count / n - 1 / 3)).toBeLessThan(0.03);
  });

  it("never puts two affixes of one group on an item", () => {
    const table = loadItems(small());
    let rares = 0;
    for (const item of rollMany(table, "stick", 1, 5000)) {
      const groups = [...item.prefixes, ...item.suffixes].map((r) => affixOf(table, r.affix).group);
      expect(new Set(groups).size).toBe(groups.length);
      if (item.rarity === "rare") rares++;
    }
    expect(rares).toBeGreaterThan(1000);
    for (const base of Object.values(ITEMS.bases)) {
      for (const item of rollMany(ITEMS, base.id, MAX_ITEM_LEVEL, 2000)) {
        const groups = [...item.prefixes, ...item.suffixes].map(
          (r) => affixOf(ITEMS, r.affix).group,
        );
        expect(new Set(groups).size).toBe(groups.length);
      }
    }
  });

  it("gives fewer affixes when the pool runs out, rather than repeating one", () => {
    const table = loadItems(small());
    const rares = rollMany(table, "stick", 1, 5000).filter((i) => i.rarity === "rare");
    // The small table's rare has room for two prefixes, but "sharp" and "keen" share a group,
    // so the most it can have is one of them, "cruel" and "aim".
    for (const item of rares) expect(item.prefixes.length + item.suffixes.length).toBeLessThan(4);
  });

  it("gives the same items for the same seed and generator state, and others for another seed", () => {
    const a = rollMany(ITEMS, "silver_ring", 60, 500, 7);
    expect(rollMany(ITEMS, "silver_ring", 60, 500, 7)).toEqual(a);
    expect(rollMany(ITEMS, "silver_ring", 60, 500, 8)).not.toEqual(a);

    const rng = createRng(7);
    rollItem(ITEMS, "silver_ring", 60, rng);
    const saved: Rng = JSON.parse(JSON.stringify(rng));
    const next = rollItem(ITEMS, "silver_ring", 60, rng);
    expect(rollItem(ITEMS, "silver_ring", 60, saved)).toEqual(next);
  });

  it("keeps giving the same items for a seed", () => {
    // A change here means every seed rolls different items. Only update it on purpose.
    const rng = createRng(2026);
    const items = Array.from({ length: 6 }, () => rollItem(ITEMS, "long_sword", 30, rng));
    const magic = items.find((i) => i.rarity !== "normal");
    expect(items.map((i) => i.rarity)).toMatchInlineSnapshot(`
      [
        "normal",
        "normal",
        "normal",
        "normal",
        "normal",
        "magic",
      ]
    `);
    expect(magic).toMatchInlineSnapshot(`
      {
        "base": "long_sword",
        "level": 30,
        "prefixes": [
          {
            "affix": "increased_damage",
            "tier": 0,
            "value": 11,
          },
        ],
        "rarity": "magic",
        "suffixes": [
          {
            "affix": "attack_speed",
            "tier": 1,
            "value": 6,
          },
        ],
      }
    `);
  });

  const refusals: [string, string, number][] = [
    ["an unknown base", "spoon", 10],
    ["a base name from the object prototype", "__proto__", 10],
    ["an item level below the base's", "long_sword", 11],
    ["an item level above the highest", "rusty_sword", MAX_ITEM_LEVEL + 1],
    ["a fractional item level", "rusty_sword", 2.5],
  ];
  for (const [what, base, level] of refusals) {
    it(`refuses ${what}`, () => {
      expect(() => rollItem(ITEMS, base, level, createRng(1))).toThrow(ItemError);
    });
  }
});

describe("itemStats and itemName", () => {
  const item = (rarity: Rarity, prefixes: [string, number][], suffixes: [string, number][]) =>
    ({
      base: "rusty_sword",
      level: 30,
      rarity,
      prefixes: prefixes.map(([affix, value]) => ({ affix, tier: 0, value })),
      suffixes: suffixes.map(([affix, value]) => ({ affix, tier: 0, value })),
    }) satisfies Item;

  it("adds the base's stats to the affixes' and applies increases, rounding down", () => {
    const stats = itemStats(
      ITEMS,
      item(
        "rare",
        [
          ["added_damage", 4],
          ["increased_damage", 15],
        ],
        [["added_accuracy", 7]],
      ),
    );
    // (3 + 4) damage raised by 15% is 8.05.
    expect(stats).toEqual({
      life: 0,
      life_regen: 0,
      damage: 8,
      damage_pct: 15,
      armour: 0,
      armour_pct: 0,
      accuracy: 7,
      speed: 0,
    });
    const vest = { ...item("magic", [["increased_armour", 34]], []), base: "chain_shirt" };
    // 14 armour raised by 34% is 18.76.
    expect(itemStats(ITEMS, vest).armour).toBe(18);
    expect(itemStats(ITEMS, item("normal", [], [])).damage).toBe(3);
  });

  it("names a magic item after its affixes and any other after its base", () => {
    const magic = item("magic", [["added_damage", 1]], [["added_accuracy", 5]]);
    expect(itemName(ITEMS, magic)).toBe("Sharp Rusty Sword of Aim");
    expect(itemName(ITEMS, item("magic", [], [["attack_speed", 3]]))).toBe("Rusty Sword of Speed");
    expect(itemName(ITEMS, { ...magic, rarity: "rare" })).toBe("Rusty Sword");
  });
});
