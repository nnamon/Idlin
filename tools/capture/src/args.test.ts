import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.ts";

const NONE = { chat: null, lookdev: null, stills: false };

describe("the capture command's arguments", () => {
  it("takes a folder and the shots named after it", () => {
    expect(parseArgs(["captures/now", "dawn:6", "noon:12"])).toEqual({
      outDir: "captures/now",
      shots: ["dawn:6", "noon:12"],
      review: false,
      baseline: null,
      ...NONE,
    });
    expect(parseArgs(["captures/now", "dawn:6"])).toMatchObject({ shots: ["dawn:6"] });
  });

  it("falls back to four shots across the day, and a default folder", () => {
    expect(parseArgs([])).toMatchObject({
      outDir: "captures/manual",
      shots: ["dawn:6", "noon:12", "dusk:19", "midnight:0"],
    });
    expect(parseArgs(["out"])).toMatchObject({
      outDir: "out",
      shots: ["dawn:6", "noon:12", "dusk:19", "midnight:0"],
    });
  });

  it("takes --review and --baseline anywhere, and adds no shots of its own to a review", () => {
    expect(parseArgs(["out", "--review"])).toEqual({
      outDir: "out",
      shots: [],
      review: true,
      baseline: null,
      ...NONE,
    });
    expect(parseArgs(["--baseline", "before", "out", "--review", "extra:9"])).toEqual({
      outDir: "out",
      shots: ["extra:9"],
      review: true,
      baseline: "before",
      ...NONE,
    });
  });

  it("takes --chat with a crowd file's name for shots, and refuses it with --review", () => {
    expect(parseArgs(["out", "--chat", "crowd-15", "noon:12"])).toEqual({
      outDir: "out",
      shots: ["noon:12"],
      review: false,
      baseline: null,
      ...NONE,
      chat: "crowd-15",
    });
    expect(parseArgs(["out", "--chat"])).toBe("--chat needs a crowd file's name");
    expect(parseArgs(["out", "--chat", "../secrets"])).toBe("--chat needs a crowd file's name");
    expect(parseArgs(["out", "--review", "--chat", "crowd-15"])).toBe(
      "--chat works with shots, not with --review",
    );
  });

  it("takes the look-development scenes to shoot, and adds no shots of the game to them", () => {
    expect(parseArgs(["out", "--lookdev", "deck,expedition", "--stills"])).toEqual({
      outDir: "out",
      shots: [],
      review: false,
      baseline: null,
      chat: null,
      lookdev: ["deck", "expedition"],
      stills: true,
    });
    expect(parseArgs(["out", "--lookdev"])).toBe("--lookdev needs scene names, or all");
    expect(parseArgs(["out", "--lookdev", "all", "--review"])).toBe(
      "--lookdev and --review are separate runs",
    );
    expect(parseArgs(["out", "--lookdev", "all", "--chat", "crowd-15"])).toBe(
      "--lookdev draws its own crowd, not --chat",
    );
    expect(parseArgs(["out", "--stills"])).toBe("--stills only works with --lookdev");
  });

  it("says what is wrong instead of guessing", () => {
    expect(parseArgs(["out", "--review", "--baseline"])).toBe("--baseline needs a folder");
    expect(parseArgs(["out", "--baseline", "--review"])).toBe("--baseline needs a folder");
    expect(parseArgs(["out", "--baseline", "before"])).toBe("--baseline only works with --review");
    expect(parseArgs(["out", "--reveiw"])).toBe("unknown option --reveiw");
    expect(parseArgs(["out", ""])).toBe("an argument is empty");
    expect(parseArgs(["out", "--review", "--baseline", ""])).toBe("--baseline needs a folder");
  });
});
