import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .claude/settings.json keeps agent sessions from running interpreters and
// in-place editors on the host (AGENTS.md section 1). This reads the file and
// checks which commands its deny rules catch, matching a rule the way Claude
// Code does for Bash: `*` stands for any run of characters. It also checks
// that sessions run with TZ=UTC, so every commit they make is dated +0000.

const file = new URL("../../../.claude/settings.json", import.meta.url);
const settings = JSON.parse(readFileSync(file, "utf8")) as {
  env?: Record<string, string>;
  permissions: { deny: string[] };
};

describe("the environment in .claude/settings.json", () => {
  it("sets TZ to UTC", () => {
    expect(settings.env?.TZ).toBe("UTC");
  });
});

function denied(command: string): boolean {
  return settings.permissions.deny.some((rule) => {
    const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
    if (inner === undefined) return false;
    const pattern = inner.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${pattern.join(".*")}$`).test(command);
  });
}

describe("the host deny list in .claude/settings.json", () => {
  it("has only Bash rules", () => {
    for (const rule of settings.permissions.deny) expect(rule).toMatch(/^Bash\(.+\)$/);
  });

  it("refuses the interpreters and in-place editors", () => {
    for (const command of [
      "python3 -c 1",
      "python -c 1",
      "python3.12 script.py",
      "perl -pi -e s/a/b/ file",
      "node -e 1",
      "ruby -e 1",
      "sed -i '' s/a/b/ file",
      "sed -i.bak s/a/b/ file",
      "awk '{print $1}' file",
      "jq . file.json",
    ]) {
      expect(denied(command), command).toBe(true);
    }
  });

  it("leaves git, gh, docker and read-only commands alone", () => {
    for (const command of [
      "git status",
      "gh issue view 280 --json body --jq .body",
      "docker compose run --rm dev pnpm gate",
      "docker compose run --rm dev node -e 1",
      "sed -n 1,20p file",
      "ls -la",
      "cat README.md",
    ]) {
      expect(denied(command), command).toBe(false);
    }
  });
});
