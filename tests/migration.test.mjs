import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SUPPORTED_EXERCISE_TYPES, gradeExercise, validatePack } from "../src/core.js";
import { registry } from "../src/exercise-registry.js";

const bundle = JSON.parse(await readFile(new URL("../data/builtin-packs.json", import.meta.url), "utf8"));
const byId = new Map(bundle.packs.map(pack => [pack.id, pack]));

test("migration bundle contains three valid independent packs", () => {
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.type, "builtin-memory-packs");
  assert.equal(bundle.packs.length, 3);
  assert.equal(new Set(bundle.packs.map(pack => pack.id)).size, 3);
  bundle.packs.forEach(pack => assert.equal(validatePack(pack).valid, true, pack.id));
});

test("all supported exercise contracts have local renderers", () => {
  assert.deepEqual(Object.keys(registry).sort(), [...SUPPORTED_EXERCISE_TYPES].sort());
});

test("politics and economics migration preserves 196 concepts and 232 authored judgments", () => {
  const pack = byId.get("seikei-memorization");
  assert.equal(pack.resources.filter(resource => resource.kind === "concept").length, 196);
  assert.equal(pack.exercises.filter(exercise => exercise.type === "text-input").length, 196);
  assert.equal(pack.exercises.filter(exercise => exercise.type === "true-false").length, 232);
  assert.equal(pack.resources.filter(resource => typeof resource.pair === "string" && resource.pair.length).length, 196);
  assert.equal(pack.resources.filter(resource => typeof resource.trap === "string" && resource.trap.length).length, 196);
  assert.equal(new Set(pack.resources.map(resource => resource.id)).size, 196);
  assert.equal(new Set(pack.exercises.map(exercise => exercise.id)).size, 428);
  assert.ok(pack.exercises.filter(exercise => exercise.type === "true-false").every(exercise => typeof exercise.metadata?.stage === "string"));
  const imf = pack.resources.find(resource => resource.id === "concept:imf");
  assert.deepEqual({ term: imf.title, clue: imf.text, pair: imf.pair }, { term: "IMF", clue: "通貨・為替安定、短期融資", pair: "ブレトンウッズ体制" });
});

test("inorganic chemistry migration preserves all 26 questions and seven legacy formats", () => {
  const pack = byId.get("inorganic-chemistry");
  assert.equal(pack.exercises.length, 26);
  assert.deepEqual(pack.metadata.legacyCounts, { questions: 26 });
  const legacyFormats = new Set(pack.exercises.map(exercise => exercise.source.legacyFormat));
  assert.deepEqual([...legacyFormats].sort(), ["analysis", "equation", "identify", "multiple", "short", "single", "truefalse"]);
  assert.ok(pack.exercises.some(exercise => JSON.stringify(exercise.payload).includes("[[chem:")));
  assert.ok(pack.exercises.every(exercise => exercise.payload.explanation));
  const accepted = pack.exercises.find(exercise => exercise.source.legacyId === "noble-gas-order-001");
  assert.ok(accepted.payload.acceptedAnswers.length >= 2);
});

test("constitution migration keeps article resources, ordered blank relationships and provenance", () => {
  const pack = byId.get("constitution-quest");
  const articles = pack.resources.filter(resource => resource.kind === "constitution-article");
  const chapters = pack.resources.filter(resource => resource.kind === "constitution-chapter");
  const stages = pack.resources.filter(resource => resource.kind === "constitution-stage");
  const cloze = pack.exercises.filter(exercise => exercise.id.startsWith("cloze:"));
  const summary = pack.exercises.filter(exercise => exercise.id.startsWith("summary-cloze:"));
  const recall = pack.exercises.filter(exercise => exercise.type === "full-recall");
  assert.deepEqual([articles.length, chapters.length, stages.length, cloze.length, summary.length, recall.length], [104, 13, 13, 280, 8, 104]);
  assert.equal(pack.metadata.contentVersion, "3");
  const segmentBlankIds = articles.flatMap(article => (article.segments || []).filter(segment => segment.type === "blank").map(segment => segment.blankId));
  assert.equal(segmentBlankIds.length, 280);
  assert.equal(new Set(segmentBlankIds).size, 280);
  const clozeLegacyIds = new Set(cloze.map(exercise => exercise.source.legacyId));
  assert.ok(segmentBlankIds.every(id => clozeLegacyIds.has(id)));
  assert.ok(cloze.every(exercise => Array.isArray(exercise.payload.acceptedAnswers) && exercise.payload.acceptedAnswers.length));
  assert.ok(summary.every(exercise => exercise.source.sourceKind === "assignment-summary"));
  assert.ok(summary.every(exercise => exercise.metadata.chapterId === "overview"));
  const preamble = articles.find(article => article.articleNumber === 0);
  assert.equal(preamble.id, "article:preamble");
  assert.ok(preamble.text.startsWith("日本国民は"));
});

test("constitution summary corrections match the school handout", () => {
  const pack = byId.get("constitution-quest");
  const summaries = new Map(pack.exercises.filter(exercise => exercise.id.startsWith("summary-cloze:")).map(exercise => [exercise.source.legacyId, exercise]));
  const cases = [
    ["summary-b5", "恒久平和主義", "平和主義", "三大基本原理の一つ", ""],
    ["summary-b6", "地方自治", "基本的人権", "", "の保障等についても規定"],
    ["summary-b7", "民主主義", "国民主権", "徹底した", "の原理を打ち出した。"]
  ];
  assert.equal(summaries.size, 8);
  for (const [legacyId, answer, rejected, before, after] of cases) {
    const exercise = summaries.get(legacyId);
    assert.ok(exercise, `${legacyId} is missing`);
    assert.equal(exercise.payload.answer, answer);
    assert.deepEqual(exercise.payload.acceptedAnswers, [answer]);
    assert.equal(exercise.payload.before, before);
    assert.equal(exercise.payload.after, after);
    assert.equal(gradeExercise(exercise, rejected).correct, false);
    assert.equal(gradeExercise(exercise, answer).correct, true);
    assert.equal(exercise.source.tags.includes(rejected), false);
  }
});

test("every resource reference resolves and original IDs remain auditable", () => {
  bundle.packs.forEach(pack => {
    const resources = new Set(pack.resources.map(resource => resource.id));
    pack.exercises.forEach(exercise => {
      if (exercise.resourceId) assert.ok(resources.has(exercise.resourceId), `${pack.id}/${exercise.id}`);
      assert.ok(exercise.source?.legacyId, `${pack.id}/${exercise.id} has no legacy id`);
    });
  });
});
