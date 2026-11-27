// Setting a refused snapshot aside. A test runs as a user that no file
// permission stops, so to make setting aside fail, `linkSync` and
// `copyFileSync` are wrapped for this file only.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, hashWorld, step, type World } from "@idlin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadContent } from "./content.ts";
import { listSnapshots, loadNewest, saveSnapshot, snapshotName } from "./store.ts";

/** The error code each call fails with, or null to let it run. */
const refuse = vi.hoisted(() => ({ link: null as string | null, copy: null as string | null }));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const fail = (code: string, call: string, from: unknown, to: unknown): never => {
    throw Object.assign(new Error(`${code}: refused, ${call} '${from}' -> '${to}'`), { code });
  };
  const linkSync: typeof fs.linkSync = (from, to) => {
    if (refuse.link) fail(refuse.link, "link", from, to);
    fs.linkSync(from, to);
  };
  const copyFileSync: typeof fs.copyFileSync = (from, to, mode) => {
    if (refuse.copy) fail(refuse.copy, "copyfile", from, to);
    fs.copyFileSync(from, to, mode);
  };
  return {
    ...fs,
    default: { ...fs, linkSync, copyFileSync },
    linkSync,
    copyFileSync,
  };
});

const CONTENT = loadContent();

const dirs: string[] = [];
afterEach(() => {
  refuse.link = null;
  refuse.copy = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "idlin-store-"));
  dirs.push(dir);
  return dir;
};

const worldAt = (tick: number): World => {
  const world = createWorld(CONTENT.atlas, 5, CONTENT.programs, CONTENT.kinds, CONTENT.spawns);
  while (world.tick < tick) step(world);
  return world;
};

describe("setting a snapshot aside", () => {
  it("keeps every snapshot set aside under the same name, each with its own contents", () => {
    const dir = tempDir();
    const name = snapshotName(500);
    const lines: string[] = [];
    // Three worlds in turn leave a refused snapshot at the same name.
    for (const text of ["{ first", "{ second", "{ third"]) {
      writeFileSync(join(dir, name), text);
      expect(loadNewest(dir, CONTENT, lines.push.bind(lines))).toBeNull();
    }
    expect(readdirSync(dir).sort()).toEqual([`${name}.1.bad`, `${name}.2.bad`, `${name}.bad`]);
    expect(readFileSync(join(dir, `${name}.bad`), "utf8")).toBe("{ first");
    expect(readFileSync(join(dir, `${name}.1.bad`), "utf8")).toBe("{ second");
    expect(readFileSync(join(dir, `${name}.2.bad`), "utf8")).toBe("{ third");
    expect(lines).toEqual(Array(3).fill(`skipping snapshot ${name}: snapshot is not valid JSON`));
  });

  it("steps past a directory at the `.bad` name and leaves it as it was", () => {
    const dir = tempDir();
    const name = snapshotName(500);
    mkdirSync(join(dir, `${name}.bad`, "inside"), { recursive: true });
    writeFileSync(join(dir, name), "{ not a snapshot");
    expect(loadNewest(dir, CONTENT, () => {})).toBeNull();
    expect(readdirSync(join(dir, `${name}.bad`))).toEqual(["inside"]);
    expect(readFileSync(join(dir, `${name}.1.bad`), "utf8")).toBe("{ not a snapshot");
    expect(listSnapshots(dir)).toEqual([]);
  });

  it.each(["EPERM", "EXDEV"])(
    "copies it aside when links fail with %s, and later saves leave the copy alone",
    (linkError) => {
      const dir = tempDir();
      saveSnapshot(dir, worldAt(101));
      const name = snapshotName(201);
      writeFileSync(join(dir, name), "{ not a snapshot");
      // Taken already, so the copy has to step past it as the link would.
      mkdirSync(join(dir, `${name}.bad`));
      refuse.link = linkError;

      const lines: string[] = [];
      const stuck = new Set<string>();
      expect(loadNewest(dir, CONTENT, lines.push.bind(lines), stuck)?.file).toBe(snapshotName(101));
      expect(lines).toEqual([`skipping snapshot ${name}: snapshot is not valid JSON`]);
      expect(stuck.size).toBe(0);
      expect(readFileSync(join(dir, `${name}.1.bad`), "utf8")).toBe("{ not a snapshot");
      expect(listSnapshots(dir)).toEqual([snapshotName(101)]);

      // The world reaches the refused snapshot's tick, and runs on until the
      // first save has been pruned.
      for (const tick of [201, 301, 401, 501]) saveSnapshot(dir, worldAt(tick));
      expect(readFileSync(join(dir, `${name}.1.bad`), "utf8")).toBe("{ not a snapshot");
      expect(readdirSync(dir).sort()).toEqual([
        `${name}.1.bad`,
        `${name}.bad`,
        ...[301, 401, 501].map(snapshotName),
      ]);
    },
  );

  it("goes on to an older snapshot when a bad one cannot be set aside, and never saves over it", () => {
    const dir = tempDir();
    saveSnapshot(dir, worldAt(101));
    const newest = snapshotName(201);
    writeFileSync(join(dir, newest), "{ not a snapshot");
    refuse.link = "EPERM";
    refuse.copy = "ENOSPC";

    const lines: string[] = [];
    const stuck = new Set<string>();
    const found = loadNewest(dir, CONTENT, lines.push.bind(lines), stuck);
    expect(lines[0]).toBe(`skipping snapshot ${newest}: snapshot is not valid JSON`);
    expect(lines[1]).toMatch(
      new RegExp(`^could not set ${newest} aside as ${newest}\\.bad: .*EPERM.*; .*ENOSPC`),
    );
    expect(found?.file).toBe(snapshotName(101));
    expect(hashWorld(found?.world as World)).toBe(hashWorld(worldAt(101)));
    expect([...stuck]).toEqual([newest]);

    // The resumed world reaches its tick: that save is refused, not written over it.
    expect(() => saveSnapshot(dir, worldAt(201), () => {}, stuck)).toThrow(
      `${newest} holds a refused snapshot that could not be set aside`,
    );
    expect(readFileSync(join(dir, newest), "utf8")).toBe("{ not a snapshot");
  });

  it("never prunes a refused snapshot it could not set aside", () => {
    const dir = tempDir();
    saveSnapshot(dir, worldAt(101));
    // Off the save cadence, so no save lands on its name; only pruning could remove it.
    const name = snapshotName(150);
    writeFileSync(join(dir, name), "{ not a snapshot");
    refuse.link = "EXDEV";
    refuse.copy = "EACCES";
    const stuck = new Set<string>();
    expect(loadNewest(dir, CONTENT, () => {}, stuck)?.file).toBe(snapshotName(101));

    for (const tick of [201, 301, 401, 501]) saveSnapshot(dir, worldAt(tick), () => {}, stuck);
    expect(listSnapshots(dir)).toEqual([...[501, 401, 301].map(snapshotName), name]);
    expect(readFileSync(join(dir, name), "utf8")).toBe("{ not a snapshot");
  });

  it("keeps the snapshot it writes when later ones it could not set aside are on disk", () => {
    const dir = tempDir();
    const later = [10001, 10002, 10003].map(snapshotName);
    for (const file of later) writeFileSync(join(dir, file), "{ not a snapshot");
    refuse.link = "EPERM";
    refuse.copy = "EPERM";
    expect(loadNewest(dir, CONTENT, () => {})).toBeNull();
    for (const tick of [1, 101, 151]) saveSnapshot(dir, worldAt(tick));
    expect(listSnapshots(dir)).toEqual([
      ...later.reverse(),
      snapshotName(151),
      snapshotName(101),
      snapshotName(1),
    ]);

    const lines: string[] = [];
    expect(loadNewest(dir, CONTENT, lines.push.bind(lines))?.file).toBe(snapshotName(151));
    expect(lines).toHaveLength(6);
  });
});
