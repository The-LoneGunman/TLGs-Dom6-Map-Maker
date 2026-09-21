import assert from "node:assert/strict";
import test from "node:test";
import { realmBackgroundOpacity } from "../src/MapCanvas";

test("underground preview backdrops remain visible without competing with playable floors", () => {
  for (const kind of ["cave", "cavern", "underworld", "hell", "abyss"] as const) {
    const opacity = realmBackgroundOpacity(kind);
    assert.ok(opacity >= 0.3 && opacity <= 0.4, `${kind} uses a restrained but visible backdrop`);
  }
});

test("underground preview polish leaves other realm backdrops unchanged", () => {
  for (const kind of ["surface", "cloud", "air", "dream", "elemental", "custom"] as const) {
    assert.equal(realmBackgroundOpacity(kind), 0.58);
  }
});
