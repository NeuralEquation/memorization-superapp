import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bossDamage,
  bossStars,
  calculateXp,
  gameStateAfterAttempt,
  getPackStages,
  levelFromXp,
  missionProgress,
  selectGameQueue,
  updateDailyStreak
} from "../src/game.js";
import { progressKey } from "../src/core.js";

const bundle = JSON.parse(await readFile(new URL("../data/builtin-packs.json", import.meta.url), "utf8"));
const byId = id => bundle.packs.find(pack => pack.id === id);

test("XP, levels, combos and boss damage preserve the source game rules", () => {
  const exercise = { importance: "A" };
  const normal = calculateXp({ correct: true, combo: 0, exercise, responseMs: 18_000, mode: "daily" });
  const combo = calculateXp({ correct: true, combo: 5, exercise, responseMs: 4_000, mode: "boss" });
  assert.ok(combo > normal);
  assert.equal(calculateXp({ correct: false }), 1);
  assert.equal(levelFromXp(0).level, 1);
  assert.ok(levelFromXp(1000).level > levelFromXp(100).level);
  assert.equal(bossDamage({ correct: false, exercise }), 0);
  assert.ok(bossDamage({ correct: true, combo: 4, exercise }) > bossDamage({ correct: true, combo: 0, exercise: { importance: "C" } }));
});

test("daily missions and study streaks use local calendar days", () => {
  const now = new Date(2026, 7, 30, 12).getTime();
  const history = [0, 1, 2].map((offset, index) => ({ attemptedAt: now + offset, correct: index !== 2 }));
  const missions = missionProgress(history, now);
  assert.equal(missions.answered, 3);
  assert.equal(missions.correct, 2);
  assert.equal(updateDailyStreak("2026-08-29", 4, now).streak, 5);
  const game = gameStateAfterAttempt({}, { correct: true, combo: 3, xp: 25, now });
  assert.equal(game.xp, 25);
  assert.equal(game.bestCombo, 3);
  assert.equal(game.dailyStreak, 1);
});

test("all three migrated packs expose their original stage semantics", () => {
  const seikei = getPackStages(byId("seikei-memorization"));
  const chemistry = getPackStages(byId("inorganic-chemistry"));
  const constitution = getPackStages(byId("constitution-quest"));
  assert.deepEqual(seikei.map(stage => stage.key), ["8-10", "11-12", "3-3-1", "4-2-6"]);
  assert.ok(chemistry.length >= 5);
  assert.equal(constitution.length, 13);
  assert.equal(constitution[0].name, "概要・前文");
  assert.ok(constitution.every(stage => stage.exerciseIds.length > 0));
});

test("boss queues stay inside the selected area and weak hunts use memory evidence", () => {
  const pack = byId("constitution-quest");
  const stage = getPackStages(pack)[1];
  const boss = selectGameQueue(pack, new Map(), { mode: "boss", stageId: stage.id, random: () => .25 });
  assert.ok(boss.length >= 10);
  assert.ok(boss.every(exercise => stage.exerciseIds.includes(exercise.id)));

  const chemistry = byId("inorganic-chemistry");
  const target = chemistry.exercises[0];
  const progress = new Map([[progressKey(chemistry.id, target.id), {
    attempts: 2, wrong: 1, correct: 1, strength: .2, recentMistakes: 1, lastOutcome: "wrong", dueAt: 1
  }]]);
  const review = selectGameQueue(chemistry, progress, { mode: "review", random: () => 0 });
  assert.equal(review[0].id, target.id);
});

test("boss stars match the constitution source thresholds", () => {
  const stage = { clearRate: .8, star3Rate: .9 };
  assert.equal(bossStars(.59, stage), 0);
  assert.equal(bossStars(.6, stage), 1);
  assert.equal(bossStars(.8, stage), 2);
  assert.equal(bossStars(.9, stage), 3);
});

test("overview stage includes all eight summaries, including older user-edited packs", () => {
  for (const legacy of [false, true]) {
    const pack = structuredClone(byId("constitution-quest"));
    const summaries = pack.exercises.filter(exercise => exercise.id.startsWith("summary-cloze:"));
    assert.equal(summaries.length, 8);
    if (legacy) summaries.forEach(exercise => { delete exercise.metadata; });
    const stage = getPackStages(pack).find(stage => stage.key === "overview");
    assert.equal(stage.exerciseIds.length, 24);
    assert.ok(summaries.every(exercise => stage.exerciseIds.includes(exercise.id)));
    const queue = selectGameQueue(pack, new Map(), { mode: "boss", stageId: stage.id, random: () => 0 });
    assert.ok(queue.some(exercise => exercise.id.startsWith("summary-cloze:")));
  }
});
