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

test("chemistry and constitution receive useful subject-specific lists", () => {
  const chemistry = buildLibrarySections(byId("inorganic-chemistry"));
  assert.equal(chemistry.find(section => section.id === "questions").entries.length, 26);
  const chemResult = filterLibraryEntries(chemistry[0], { query: "五円硬貨", importance: "all", status: "all", group: "all" }, "inorganic-chemistry", new Map());
  assert.ok(chemResult.some(entry => entry.item.id === "question:alloy-brass-001"));

  const constitution = buildLibrarySections(byId("constitution-quest"));
  assert.equal(constitution.find(section => section.id === "articles").entries.length, 104);
  assert.equal(constitution.find(section => section.id === "cloze").entries.length, 288);
  assert.equal(constitution.find(section => section.id === "full-recall").entries.length, 104);
});
