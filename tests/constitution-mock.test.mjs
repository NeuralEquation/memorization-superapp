import assert from "node:assert/strict";
import test from "node:test";
import { gradeExercise } from "../src/core.js";
import {
  CONSTITUTION_MOCK_COUNT,
  buildConstitutionMockModel,
  getConstitutionMockCandidates,
  gradeConstitutionMock,
  isConstitutionMockTimedOut,
  selectConstitutionMockExercises
} from "../src/constitution-mock.js";
import bundle from "../data/builtin-packs.json" with { type: "json" };

const pack = bundle.packs.find(item => item.id === "constitution-quest");

test("constitution mock selects exactly 30 unique cloze candidates", () => {
  assert.equal(getConstitutionMockCandidates(pack).length, 288);
  const first = selectConstitutionMockExercises(pack, { random: () => 0.42 });
  const second = selectConstitutionMockExercises(pack, { random: () => 0.42 });
  assert.equal(first.length, CONSTITUTION_MOCK_COUNT);
  assert.equal(new Set(first.map(exercise => exercise.id)).size, CONSTITUTION_MOCK_COUNT);
  assert.deepEqual(first.map(exercise => exercise.id), second.map(exercise => exercise.id));
  assert.ok(first.every(exercise => exercise.id.startsWith("cloze:") || exercise.id.startsWith("summary-cloze:")));
});

test("constitution mock ordering is summary, preamble, then article number", () => {
  const selected = selectConstitutionMockExercises(pack, { random: () => 0.1 });
  const rank = exercise => exercise.id.startsWith("summary-cloze:") ? 0 : pack.resources.find(resource => resource.id === exercise.resourceId)?.articleNumber || 0;
  const ranks = selected.map(rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => (a === 0 ? -1 : a) - (b === 0 ? -1 : b)));
  const summaryCount = selected.filter(exercise => exercise.id.startsWith("summary-cloze:")).length;
  const preambleIndex = selected.findIndex(exercise => exercise.resourceId === "article:preamble");
  if (summaryCount && preambleIndex >= 0) assert.ok(preambleIndex >= summaryCount);
});

test("constitution mock model keeps article segments and hides only selected blanks", () => {
  const selectedIds = ["summary-cloze:summary-b1", "cloze:preamble-b1", "cloze:article-14-b1"];
  const selected = selectedIds.map(id => pack.exercises.find(exercise => exercise.id === id));
  const model = buildConstitutionMockModel(pack, selected);
  assert.deepEqual(model.groups.map(group => group.label), ["基本事項", "前文", "第14条"]);
  assert.equal(model.groups[0].items[0].before, "1946（昭和21）年11月3日に");
  const preamble = model.groups.find(group => group.label === "前文");
  assert.ok(preamble.segments.some(segment => segment.type === "input" && segment.exerciseId === "cloze:preamble-b1"));
  assert.ok(preamble.segments.some(segment => segment.type === "text" && segment.text === "代表者"));
  assert.equal(JSON.stringify(model).includes("前文"), true);
  assert.equal(JSON.stringify(model).includes("日本国民たる要件"), false);
  assert.equal(JSON.stringify(model).includes("acceptedAnswers"), false);
});

test("constitution mock grades through gradeExercise and marks blanks unanswered", () => {
  const selected = selectConstitutionMockExercises(pack, { random: () => 0.77 });
  const responses = Object.fromEntries(selected.map(exercise => [exercise.id, exercise.payload.acceptedAnswers[0]]));
  responses[selected[0].id] = "";
  const result = gradeConstitutionMock(pack, selected.map(exercise => exercise.id), responses);
  assert.equal(result.total, 30);
  assert.equal(result.correct, 29);
  assert.equal(result.incorrect, 1);
  assert.equal(result.unanswered, 1);
  assert.equal(result.accuracy, 97);
  assert.deepEqual(result.items[1], { ...result.items[1], correct: true, unanswered: false });
  assert.deepEqual(gradeExercise(selected[1], responses[selected[1].id]), { correct: true, expected: selected[1].payload.acceptedAnswers });
});

test("constitution mock timeout uses endsAt instead of decrementing state", () => {
  assert.equal(isConstitutionMockTimedOut({ endsAt: 1_000 }, 999), false);
  assert.equal(isConstitutionMockTimedOut({ endsAt: 1_000 }, 1_000), true);
});
