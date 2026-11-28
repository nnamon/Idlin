// Prints a generated landing as text.
//   docker compose run --rm dev node packages/sim/scripts/landing.ts <size> [seed] [biome] [level] [--districts] [--rings] [--graph]
// size is clearing, vale or valley; seed defaults to 1, biome to meadow and
// level to 5. --districts prints the map by district and --rings by ring,
// instead of by terrain; --graph adds the layout graph, a line a district,
// passage and entry.

import { generateLanding, LandingError, landingGraphText, landingText } from "../src/landing.ts";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [size, seed = "1", biome = "meadow", level = "5"] = args.filter((a) => !a.startsWith("--"));
try {
  const landing = generateLanding({ seed: Number(seed), size, biome, level: Number(level) });
  const view = flags.has("--districts") ? "districts" : flags.has("--rings") ? "rings" : "terrain";
  console.log(landingText(landing, view));
  if (flags.has("--graph")) console.log(landingGraphText(landing));
} catch (error) {
  if (!(error instanceof LandingError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
