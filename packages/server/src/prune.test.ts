// Deleting old snapshots is made to fail, which a plain filesystem in a test
// cannot be made to do without also stopping the write, so `unlinkSync` is
// wrapped for this file only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadContent } from "./content.ts";
import { WorldServer } from "./server.ts";
import { listSnapshots } from "./store.ts";

const refuse = vi.hoisted(() => ({ deletes: false }));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const unlinkSync: typeof fs.unlinkSync = (path) => {
    if (refuse.deletes && /world-\d{16}\.json$/.test(String(path))) {
      throw Object.assign(new Error(`EPERM: operation not permitted, unlink '${path}'`), {
        code: "EPERM",
      });
    }
    fs.unlinkSync(path);
  };
  return { ...fs, default: { ...fs, unlinkSync }, unlinkSync };
});

const dirs: string[] = [];
afterEach(() => {
  refuse.deletes = false;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("counts a save as made when the new snapshot is written but an old one cannot be deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "idlin-prune-"));
  dirs.push(dir);
  const lines: string[] = [];
  const server = await WorldServer.start({
    dataDir: dir,
    port: 0,
    host: "127.0.0.1",
    seed: 5,
    residents: 6,
    snapshotTicks: 100,
    log: (line) => lines.push(line),
    content: loadContent(),
  });
  server.advance(350);
  expect(listSnapshots(dir)).toHaveLength(3);
  refuse.deletes = true;
  expect(await server.stop()).toBe(true);
  expect(listSnapshots(dir)[0]).toBe("world-0000000000000351.json");
  expect(lines.at(-1)).toMatch(
    /^saved world-0000000000000351\.json but could not delete world-0000000000000101\.json: .*EPERM/,
  );
});
