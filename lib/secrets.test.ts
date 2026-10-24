import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("no secrets in tracked files", () => {
  it("no Anthropic API key in anything git tracks", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const leaks = files.filter((f) => {
      try {
        return /sk-ant-[A-Za-z0-9_-]{16,}/.test(readFileSync(f, "utf8"));
      } catch {
        return false;
      }
    });
    expect(leaks).toEqual([]);
  });
});
