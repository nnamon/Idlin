// Prints a generated landing as text.
//   docker compose run --rm dev node packages/sim/scripts/landing.ts <size> [seed] [biome] [level] [--city <1|2>] [--far <level>] [--districts] [--rings] [--graph]
// size is small, medium or large; seed defaults to 1, biome to meadow,
// level to 5, the city to 1 and the far level to the generator's default.
// --districts prints the map by district and --rings by ring, instead of by
// terrain; --graph adds the layout graph, a line a district, passage and entry.

import { generateLanding, LandingError, landingGraphText, landingText } from "../src/landing.ts";

const args = process.argv.slice(2);
const option = (flag: string): number | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : Number(args[at + 1]);
};
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [size, seed = "1", biome = "meadow", level = "5"] = args.filter(
  (a, k) => !a.startsWith("--") && args[k - 1] !== "--city" && args[k - 1] !== "--far",
);
try {
  const landing = generateLanding({
    seed: Number(seed),
    city: option("--city") ?? 1,
    size,
    biome,
    level: Number(level),
    ...(option("--far") === undefined ? {} : { far: option("--far") }),
  });
  const view = flags.has("--districts") ? "districts" : flags.has("--rings") ? "rings" : "terrain";
  console.log(landingText(landing, view));
  if (flags.has("--graph")) console.log(landingGraphText(landing));
} catch (error) {
  if (!(error instanceof LandingError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
