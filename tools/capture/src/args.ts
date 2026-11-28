// The capture command's arguments, parsed apart from the rest so they can be tested.

export interface Args {
  readonly outDir: string;
  /** Named single frames, as `name:hour[:ticks[:width[:height]]]`. */
  readonly shots: readonly string[];
  readonly review: boolean;
  /** A folder holding an earlier review's storyboard to compare with. */
  readonly baseline: string | null;
  /** A crowd file in content/chat/, by name, whose chatters are the citizens of the shots. */
  readonly chat: string | null;
  /** The look-development scenes to shoot (`all` for every one), or null for the game itself. */
  readonly lookdev: readonly string[] | null;
  /** With `--lookdev`: stills only, without the bursts, clips and bench. */
  readonly stills: boolean;
}

const DEFAULT_SHOTS = ["dawn:6", "noon:12", "dusk:19", "midnight:0"];

/** Returns the arguments, or a message saying what is wrong with them. */
export function parseArgs(argv: readonly string[]): Args | string {
  const plain: string[] = [];
  let review = false;
  let stills = false;
  let baseline: string | null = null;
  let chat: string | null = null;
  let lookdev: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "") return "an argument is empty";
    if (arg === "--review") review = true;
    else if (arg === "--stills") stills = true;
    else if (arg === "--baseline") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return "--baseline needs a folder";
      baseline = value;
    } else if (arg === "--chat") {
      const value = argv[++i];
      if (!value || !/^[a-z0-9_-]{1,64}$/.test(value)) return "--chat needs a crowd file's name";
      chat = value;
    } else if (arg === "--lookdev") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return "--lookdev needs scene names, or all";
      lookdev = value.split(",").filter((name) => name !== "");
    } else if (arg.startsWith("--")) return `unknown option ${arg}`;
    else plain.push(arg);
  }
  if (baseline !== null && !review) return "--baseline only works with --review";
  // The review's sheets follow the page's world in a world of their own, which has no chat yet.
  if (chat !== null && review) return "--chat works with shots, not with --review";
  if (lookdev !== null && review) return "--lookdev and --review are separate runs";
  if (lookdev !== null && chat !== null) return "--lookdev draws its own crowd, not --chat";
  if (stills && lookdev === null) return "--stills only works with --lookdev";
  const [outDir = "captures/manual", ...shots] = plain;
  return {
    outDir,
    shots: shots.length > 0 || review || lookdev !== null ? shots : DEFAULT_SHOTS,
    review,
    baseline,
    chat,
    lookdev,
    stills,
  };
}
