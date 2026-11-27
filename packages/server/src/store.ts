// World snapshots on disk. Each is the sim's own snapshot text (which carries
// its version and a hash of its contents) in a file named for its tick, so the
// newest sorts last. Files are written beside their final name and renamed into
// place, so a crash mid-write leaves the previous snapshot as the newest.
import {
  constants,
  copyFileSync,
  linkSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { restore, SnapshotError, snapshot, type World } from "@idlin/sim";
import type { Content } from "./content.ts";

/**
 * How many snapshots up to the current tick are kept; older ones are deleted
 * after each save. Snapshots at a later tick than the one saved are never
 * deleted.
 */
export const KEEP_SNAPSHOTS = 3;

const FILE = /^world-(\d{16})\.json$/;

export const snapshotName = (tick: number): string =>
  `world-${String(tick).padStart(16, "0")}.json`;

const isPlainFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

/** Snapshot file names in `dir`, newest first. Directories and symlinks are not snapshots. */
export function listSnapshots(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => FILE.test(file) && isPlainFile(join(dir, file)))
    .sort()
    .reverse();
}

/**
 * Writes the world to `dir` and deletes all but the newest KEEP_SNAPSHOTS at or
 * before its tick. Names in `keep` (refused snapshots that could not be set
 * aside) are neither written over nor deleted.
 * Returns the file name. Throws if the new snapshot was not written, including
 * when its name is in `keep`; an old one that cannot be deleted is logged and
 * left, and the save still counts.
 */
export function saveSnapshot(
  dir: string,
  world: World,
  log: (line: string) => void = () => {},
  keep: ReadonlySet<string> = new Set(),
): string {
  const name = snapshotName(world.tick);
  if (keep.has(name)) {
    throw new Error(`${name} holds a refused snapshot that could not be set aside`);
  }
  const temp = join(dir, `.${name}.tmp`);
  // Whatever is at the temporary name (a file left by a crash, or a symlink) is
  // removed, not written through, and the file is then created only if nothing
  // is there, so the write cannot be redirected elsewhere.
  try {
    unlinkSync(temp);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  writeFileSync(temp, snapshot(world), { flag: "wx" });
  renameSync(temp, join(dir, name));
  let older: string[] = [];
  try {
    // Only snapshots at or before this tick are ranked, so the one just written is
    // always among those kept. A later one is left alone: the server did not
    // resume from it, so it could not be read, and it is kept to look at.
    older = listSnapshots(dir)
      .filter((file) => file <= name && !keep.has(file))
      .slice(KEEP_SNAPSHOTS);
  } catch (error) {
    log(`saved ${name} but could not list old snapshots to delete: ${String(error)}`);
  }
  for (const old of older) {
    try {
      unlinkSync(join(dir, old));
    } catch (error) {
      log(`saved ${name} but could not delete ${old}: ${String(error)}`);
    }
  }
  return name;
}

/**
 * The world from the newest snapshot in `dir` that restores, or null if none
 * does. Each snapshot that fails is logged with the reason and the next older
 * one is tried. One the sim refuses is set aside under a name ending in `.bad`,
 * so it is kept to look at and never tried again; if that fails too, that is
 * logged, its name is added to `stuck`, and the search goes on. The caller
 * passes `stuck` to saveSnapshot as `keep`, so that file is not lost.
 */
export function loadNewest(
  dir: string,
  content: Content,
  log: (line: string) => void,
  stuck: Set<string> = new Set(),
): { world: World; file: string } | null {
  for (const file of listSnapshots(dir)) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch (error) {
      log(`skipping snapshot ${file}: cannot read it: ${String(error)}`);
      continue;
    }
    try {
      const { atlas, programs, kinds, spawns } = content;
      return { world: restore(text, atlas, programs, kinds, spawns), file };
    } catch (error) {
      if (!(error instanceof SnapshotError)) {
        // Not a refusal of the file; it may be this build's fault, so the file is left as it is.
        log(`skipping snapshot ${file}: ${String(error)}`);
        continue;
      }
      log(`skipping snapshot ${file}: ${error.message}`);
    }
    if (!setAside(dir, file, log)) stuck.add(file);
  }
  return null;
}

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/**
 * Moves a refused snapshot to the first free name of `<file>.bad`, `<file>.1.bad`,
 * `<file>.2.bad` and so on, and says whether it did. A new world starts again at
 * tick 1, so its snapshots can take the names of a world set aside before. The
 * new name is made with a hard link, or where links are refused with a copy
 * made with COPYFILE_EXCL; both fail rather than replace whatever is there. Only
 * after one of them succeeds is the old name removed, so no file is ever
 * replaced or lost.
 */
function setAside(dir: string, file: string, log: (line: string) => void): boolean {
  for (let n = 0; ; n++) {
    const bad = n === 0 ? `${file}.bad` : `${file}.${n}.bad`;
    try {
      linkSync(join(dir, file), join(dir, bad));
    } catch (error) {
      if (code(error) === "EEXIST") continue;
      try {
        copyFileSync(join(dir, file), join(dir, bad), constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (code(copyError) === "EEXIST") continue;
        log(`could not set ${file} aside as ${bad}: ${String(error)}; ${String(copyError)}`);
        return false;
      }
    }
    try {
      unlinkSync(join(dir, file));
    } catch (error) {
      log(`set ${file} aside as ${bad} but could not remove ${file}: ${String(error)}`);
    }
    return true;
  }
}
