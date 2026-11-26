import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The simulation must compute the same world everywhere. These are the ways
// code usually breaks that; none may appear in simulation source.
const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, "Math.random (use the world's seeded generator)"],
  [/\bDate\b/, "Date (the simulation has no wall clock)"],
  [/\bperformance\b/, "performance (the simulation has no wall clock)"],
  [/\bMath\.(sin|cos|tan|sqrt|pow|exp|log\w*|atan2?|hypot|cbrt)\b/, "floating-point maths"],
  [/\bsetTimeout\b|\bsetInterval\b/, "timers"],
];

describe("simulation purity", () => {
  const dir = new URL(".", import.meta.url);
  const sources = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testing.ts",
  );

  it("finds the simulation sources", () => {
    expect(sources).toContain("world.ts");
    expect(sources).toContain("rng.ts");
  });

  for (const file of sources) {
    it(`${file} uses nothing that differs between machines`, () => {
      const code = readFileSync(new URL(file, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const [pattern, why] of FORBIDDEN) {
        expect(pattern.test(code), `${file} uses ${why}`).toBe(false);
      }
    });
  }

  it("the check itself catches a violation", () => {
    const bad = "const roll = Math.random(); const now = Date.now();";
    expect(FORBIDDEN.filter(([pattern]) => pattern.test(bad))).toHaveLength(2);
  });
});
