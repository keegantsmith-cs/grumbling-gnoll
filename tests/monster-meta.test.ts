// Monster speeds and senses read from a stat block (used for range rings on the map).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-meta-"));
const { monsterMeta } = await import("../server/realtime.ts");

test("monsters: walking, flying and swimming speeds and senses", () => {
  const m = monsterMeta({ speed: "40 ft., fly 80 ft., swim 40 ft.", senses: "blindsight 60 ft., darkvision 120 ft., passive Perception 21", actions: [] });
  assert.equal(m.speed, 40);
  assert.deepEqual(m.otherSpeeds, [{ kind: "fly", feet: 80 }, { kind: "swim", feet: 40 }]);
  assert.deepEqual(m.vision, [{ kind: "blindsight", feet: 60 }, { kind: "darkvision", feet: 120 }]);
});

test("monsters: swim-only and fly-only creatures have no walking speed", () => {
  assert.equal(monsterMeta({ speed: "swim 40 ft.", senses: "" }).speed, 0);
  assert.equal(monsterMeta({ speed: "fly 90 ft., hover true", senses: "" }).speed, 0);
  assert.equal(monsterMeta({ speed: "", senses: "" }).speed, 30);
  assert.equal(monsterMeta({ speed: "Walk 25 ft., Climb 25 ft.", senses: "Darkvision 60 ft." }).speed, 25);
});

test("monsters: attack reach and ranges", () => {
  const m = monsterMeta({ speed: "30 ft.", senses: "", actions: [
    { name: "Spear", description: "Melee or Ranged Weapon Attack: +3 to hit, reach 5 ft. or range 20/60 ft., one target." },
    { name: "Bite", description: "Melee Weapon Attack: +5 to hit, reach 10 ft., one target." },
  ] });
  assert.deepEqual(m.attacks, [{ name: "Spear", reach: 5, normal: 20, long: 60 }, { name: "Bite", reach: 10, normal: undefined, long: undefined }]);
});
