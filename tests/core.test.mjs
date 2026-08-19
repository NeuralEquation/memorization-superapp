import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_TYPE,
  PACK_TYPE,
  SCHEMA_VERSION,
  gradeExercise,
  memoryFlags,
  normalizeAnswer,
  progressKey,
  scheduleWrongRetry,
  selectPackReviewQueue,
  selectReviewQueue,
  updateMemory,
  validateBackup,
  validatePack
} from "../src/core.js";

function textExercise(id = "q1") {
  return { id, type: "text-input", importance: "B", payload: { prompt: "首都は？", acceptedAnswers: ["東京"] } };
}

function pack(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: PACK_TYPE,
    id: "pack-1",
    subject: { id: "subject", name: "科目" },
    title: "教材",
    status: "active",
    resources: [],
    exercises: [textExercise()],
    ...overrides
  };
}

test("answer normalization permits width and whitespace differences but rejects partial answers", () => {
  assert.equal(normalizeAnswer(" Ｔｏｋｙｏ（東京） "), "tokyo東京");
  assert.equal(gradeExercise(textExercise(), "　東 京 ").correct, true);
  assert.equal(gradeExercise(textExercise(), "東").correct, false);
});

test("graders preserve choice, multiple choice and true/false semantics", () => {
  const single = { id: "s", type: "single-choice", payload: { prompt: "p", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "b" } };
  const multiple = { id: "m", type: "multiple-choice", payload: { prompt: "p", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], correctOptionIds: ["a", "c"] } };
  const truth = { id: "t", type: "true-false", payload: { statement: "s", answer: false } };
  assert.equal(gradeExercise(single, "b").correct, true);
  assert.equal(gradeExercise(single, "a").correct, false);
  assert.equal(gradeExercise(multiple, ["c", "a"]).correct, true);
  assert.equal(gradeExercise(multiple, ["a"]).correct, false);
  assert.equal(gradeExercise(truth, "false").correct, true);
  assert.equal(gradeExercise(truth, "true").correct, false);
});

test("pack validation rejects duplicates, broken resources and unsupported types", () => {
  assert.equal(validatePack(pack()).valid, true);
  const invalid = pack({
    resources: [{ id: "r1", kind: "article" }],
    exercises: [textExercise("same"), textExercise("same"), { id: "broken", type: "future-type", resourceId: "missing", payload: {} }]
  });
  const result = validatePack(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.message.includes("重複")));
  assert.ok(result.errors.some(error => error.message.includes("未対応")));
  assert.ok(result.errors.some(error => error.message.includes("参照先")));
});

test("backup validation rejects malformed packs without throwing", () => {
  const value = { schemaVersion: 1, type: BACKUP_TYPE, packs: [null], progress: [], history: [] };
  assert.doesNotThrow(() => validateBackup(value));
  assert.equal(validateBackup(value).valid, false);
});

test("backup validation checks progress identity, exercise references and history", () => {
  const base = pack();
  const record = {
    key: progressKey(base.id, "q1"), packId: base.id, exerciseId: "q1", attempts: 1, correct: 1, wrong: 0,
    hesitant: 0, lapses: 0, streak: 1, strength: .3, stabilityDays: .5, recentMistakes: 0, averageResponseMs: 1200, dueAt: Date.now()
  };
  const history = { id: "h1", packId: base.id, exerciseId: "q1", interactionType: "text-input", correct: true, attemptedAt: Date.now() };
  const valid = { schemaVersion: 1, type: BACKUP_TYPE, packs: [base], progress: [record], history: [history] };
  assert.equal(validateBackup(valid).valid, true);
  const badKey = structuredClone(valid); badKey.progress[0].key = "wrong";
  assert.equal(validateBackup(badKey).valid, false);
  const badExercise = structuredClone(valid); badExercise.progress[0].exerciseId = "missing"; badExercise.progress[0].key = progressKey(base.id, "missing");
  assert.equal(validateBackup(badExercise).valid, false);
  const duplicateHistory = structuredClone(valid); duplicateHistory.history.push(structuredClone(history));
  assert.equal(validateBackup(duplicateHistory).valid, false);
});

test("memory engine distinguishes recognition from recall evidence", () => {
  const at = new Date("2026-08-20T03:00:00Z").getTime();
  const choice = updateMemory(null, { packId: "p", exerciseId: "q", interactionType: "single-choice", correct: true, rating: "good", responseMs: 1500 }, at);
  const recall = updateMemory(null, { packId: "p", exerciseId: "q", interactionType: "text-input", correct: true, rating: "good", responseMs: 1500 }, at);
  assert.ok(recall.strength > choice.strength);
  assert.equal(choice.evidence["single-choice"].correct, 1);
  assert.equal(recall.evidence["text-input"].correct, 1);
});

test("same-day recovery after a mistake is not treated as durable mastery", () => {
  const at = new Date("2026-08-20T03:00:00Z").getTime();
  const wrong = updateMemory(null, { packId: "p", exerciseId: "q", interactionType: "text-input", correct: false, rating: "again", responseMs: 2000 }, at);
  const recovered = updateMemory(wrong, { packId: "p", exerciseId: "q", interactionType: "text-input", correct: true, rating: "easy", responseMs: 1000 }, at + 5 * 60_000);
  assert.ok(recovered.strength < .4);
  assert.ok(recovered.stabilityDays <= 1);
  assert.equal(recovered.recentMistakes, 1);
  assert.ok(recovered.dueAt - (at + 5 * 60_000) <= .75 * 86_400_000);
});

test("cross-day recall grows stability and clears recent mistakes faster", () => {
  const at = new Date("2026-08-20T03:00:00Z").getTime();
  const first = updateMemory(null, { packId: "p", exerciseId: "q", interactionType: "cloze", correct: true, rating: "good" }, at);
  const nextDay = updateMemory(first, { packId: "p", exerciseId: "q", interactionType: "cloze", correct: true, rating: "good" }, at + 2 * 86_400_000);
  assert.ok(nextDay.stabilityDays > first.stabilityDays);
  assert.equal(nextDay.lastCrossDaySuccessAt, at + 2 * 86_400_000);
});

test("memory engine rejects invalid ratings and cross-item identity pollution", () => {
  assert.throws(() => updateMemory(null, { packId: "p", exerciseId: "q", interactionType: "text-input", correct: true, rating: "magic" }), /rating/);
  const previous = updateMemory(null, { packId: "p", exerciseId: "q1", interactionType: "text-input", correct: true, rating: "good" }, 1000);
  assert.throws(() => updateMemory(previous, { packId: "p", exerciseId: "q2", interactionType: "text-input", correct: true, rating: "good" }, 2000), /identity/);
});

test("recommended selection protects urgent reviews and still advances unseen items", () => {
  const exercises = Array.from({ length: 10 }, (_, index) => textExercise(`q${index}`));
  const now = Date.now();
  const progress = new Map();
  progress.set(progressKey("p", "q0"), { attempts: 3, wrong: 2, correct: 1, strength: .2, recentMistakes: 2, lastOutcome: "wrong", dueAt: now - 1000 });
  progress.set(progressKey("p", "q1"), { attempts: 2, wrong: 0, correct: 2, strength: .8, recentMistakes: 0, lastOutcome: "correct", dueAt: now - 1000 });
  const one = selectReviewQueue(exercises, progress, { packId: "p", limit: 1, now, random: () => 0 });
  assert.equal(one[0].id, "q0");
  const five = selectReviewQueue(exercises, progress, { packId: "p", limit: 5, now, random: () => 0 });
  assert.ok(five.some(exercise => exercise.id === "q0"));
  assert.ok(five.some(exercise => !progress.has(progressKey("p", exercise.id))));
});

test("archived packs cannot enter normal selection and restore keeps progress usable", () => {
  const active = pack({ status: "active" });
  const archived = pack({ status: "archived" });
  const progress = new Map();
  assert.equal(selectPackReviewQueue(archived, progress, { limit: 10 }).length, 0);
  assert.equal(selectPackReviewQueue(active, progress, { limit: 10 }).length, 1);
});

test("wrong retry waits for at least three distinct intervening questions", () => {
  const target = textExercise("target");
  const short = [textExercise("a"), textExercise("b")];
  assert.deepEqual(scheduleWrongRetry(short, target, () => 0).map(item => item.id), ["a", "b"]);
  const enough = ["a", "b", "c", "d", "e"].map(textExercise);
  const scheduled = scheduleWrongRetry(enough, target, () => 0);
  assert.equal(scheduled.length, 6);
  assert.equal(scheduled[3].id, "target");
  assert.equal(scheduled[3].__wrongRetry, true);
});

test("memory flags expose unseen, wrong, weak, hesitant and due states", () => {
  assert.equal(memoryFlags(null).unseen, true);
  const flags = memoryFlags({ attempts: 2, wrong: 1, correct: 1, strength: .2, recentMistakes: 1, lastOutcome: "hesitant", dueAt: 1 }, Date.now());
  assert.equal(flags.wrong, true);
  assert.equal(flags.weak, true);
  assert.equal(flags.hesitant, true);
  assert.equal(flags.due, true);
});

