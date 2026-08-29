import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLibrarySections, entryStatus, filterLibraryEntries, sectionGroups } from "../src/library.js";

const bundle = JSON.parse(await readFile(new URL("../data/builtin-packs.json", import.meta.url), "utf8"));
const byId = id => bundle.packs.find(pack => pack.id === id);

test("politics library preserves flashcards and true-false lists", () => {
  const pack = byId("seikei-memorization");
  const sections = buildLibrarySections(pack);
  assert.equal(sections.find(section => section.id === "concepts").entries.length, 196);
  assert.equal(sections.find(section => section.id === "judgements").entries.length, 232);
  assert.ok(sectionGroups(sections[0]).includes("8-10"));
});

test("library search covers term, clue, pair and confusion trap", () => {
  const pack = byId("seikei-memorization");
  const concepts = buildLibrarySections(pack).find(section => section.id === "concepts");
  const progress = new Map();
  for (const query of ["IMF", "短期融資", "ブレトンウッズ体制", "IBRDと役割を逆にする"]) {
    const result = filterLibraryEntries(concepts, { query, importance: "all", status: "all", group: "all" }, pack.id, progress);
    assert.ok(result.some(entry => entry.item.id === "concept:imf"), query);
  }
});

test("library filters by importance, range and saved learning status", () => {
  const pack = byId("seikei-memorization");
  const concepts = buildLibrarySections(pack).find(section => section.id === "concepts");
  const progress = new Map([[`${pack.id}::concept-input:imf`, { attempts: 2, strength: 0.2, dueAt: Date.now() + 100000, lastOutcome: "correct" }]]);
  const filtered = filterLibraryEntries(concepts, { query: "", importance: "A", status: "weak", group: "8-10" }, pack.id, progress);
  assert.ok(filtered.some(entry => entry.item.id === "concept:imf"));
  assert.equal(entryStatus(filtered.find(entry => entry.item.id === "concept:imf"), pack.id, progress), "weak");
});

test("library can filter flashcards by saved favorites", () => {
  const pack = byId("seikei-memorization");
  const concepts = buildLibrarySections(pack).find(section => section.id === "concepts");
  const favorites = filterLibraryEntries(concepts, { query: "", importance: "all", status: "all", group: "all", favorite: "favorites", favoriteIds: new Set(["concept:imf"]) }, pack.id, new Map());
  assert.deepEqual(favorites.map(entry => entry.item.id), ["concept:imf"]);
});

test("chemistry and constitution receive useful subject-specific lists", () => {
  const chemistry = buildLibrarySections(byId("inorganic-chemistry"));
  assert.equal(chemistry.find(section => section.id === "questions").entries.length, 26);
  const chemResult = filterLibraryEntries(chemistry[0], { query: "五円硬貨", importance: "all", status: "all", group: "all" }, "inorganic-chemistry", new Map());
  assert.ok(chemResult.some(entry => entry.item.id === "question:alloy-brass-001"));

  const constitution = buildLibrarySections(byId("constitution-quest"));
  assert.equal(constitution.find(section => section.id === "articles").entries.length, 104);
  const articleCloze = constitution.find(section => section.id === "cloze");
  assert.equal(articleCloze.entries.length, 88);
  assert.equal(articleCloze.entries.reduce((sum, entry) => sum + entry.exerciseIds.length, 0), 280);
  const articleBlankCount = articleCloze.entries.reduce((sum, entry) => {
    const exerciseBlankIds = new Set(entry.exercises.map(exercise => exercise.source?.legacyId));
    const blankSegments = entry.item.segments.filter(segment => segment.type === "blank");
    assert.ok(blankSegments.every(segment => exerciseBlankIds.has(segment.blankId)), `${entry.item.id} has an unmapped blank`);
    assert.equal(blankSegments.length, entry.exerciseIds.length, `${entry.item.id} blank count`);
    return sum + blankSegments.length;
  }, 0);
  assert.equal(articleBlankCount, 280);
  assert.ok(sectionGroups(articleCloze).includes("国民の権利及び義務 I"));
  assert.ok(!sectionGroups(articleCloze).includes("rights-1"));
  assert.equal(constitution.find(section => section.id === "summary-cloze").entries.length, 8);
  assert.equal(constitution.find(section => section.id === "full-recall").entries.length, 104);
  const clozeSearch = filterLibraryEntries(articleCloze, { query: "選挙", importance: "all", status: "all", group: "all" }, "constitution-quest", new Map());
  assert.ok(clozeSearch.some(entry => entry.item.id === "article:preamble"));
});
