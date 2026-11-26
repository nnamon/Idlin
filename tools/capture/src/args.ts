// The capture command's arguments, parsed apart from the rest so they can be tested.

export interface Args {
  readonly outDir: string;
  /** Named single frames, as `name:hour[:ticks[:width[:height]]]`. */
  readonly shots: readonly string[];
  readonly review: boolean;
  /** A folder holding an earlier review's storyboard to compare with. */
  readonly baseline: string | null;
}

const DEFAULT_SHOTS = ["dawn:6", "noon:12", "dusk:19", "midnight:0"];

/** Returns the arguments, or a message saying what is wrong with them. */
export function parseArgs(argv: readonly string[]): Args | string {
  const plain: string[] = [];
  let review = false;
  let baseline: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "") return "an argument is empty";
    if (arg === "--review") review = true;
    else if (arg === "--baseline") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return "--baseline needs a folder";
      baseline = value;
    } else if (arg.startsWith("--")) return `unknown option ${arg}`;
    else plain.push(arg);
  }
  if (baseline !== null && !review) return "--baseline only works with --review";
  const [outDir = "captures/manual", ...shots] = plain;
  return {
    outDir,
    shots: shots.length > 0 || review ? shots : DEFAULT_SHOTS,
    review,
    baseline,
  };
}
