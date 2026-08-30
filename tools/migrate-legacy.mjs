import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { validatePack } from "../src/core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const legacyRoot = resolve(root, "..");
const sourcePaths = {
  memorization: resolve(legacyRoot, "政経", "memorization_game", "index.html"),
  inorganic: resolve(legacyRoot, "無機化学", "data", "questions.json"),
  constitution: resolve(legacyRoot, "政経", "constitution-quest", "data")
};
const outputPath = resolve(root, "data", "builtin-packs.json");

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const source = (path, extra = {}) => ({ sourcePath: path.replaceAll("\\", "/"), ...extra });
const importance = value => value === "A" ? "A" : value === "B" ? "B" : "C";

function literalArray(html, variable) {
  const marker = `const ${variable} = [`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`${variable} の配列が見つかりません`);
  const open = html.indexOf("[", start);
  let quote = null, escaped = false, depth = 0;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (["'", "\"", "`"].includes(char)) { quote = char; continue; }
    if (char === "[") depth += 1;
    if (char === "]" && --depth === 0) return vm.runInNewContext(`(${html.slice(open, index + 1)})`);
  }
  throw new Error(`${variable} の配列終端が見つかりません`);
}

function makePack({ id, title, subject, resources, exercises, metadata }) {
  return {
    schemaVersion: 1, type: "memory-pack", id, title, subject, status: "active",
    createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z",
    resources, exercises, metadata: { contentVersion: "1", migratedFrom: "legacy-study-pwa", ...metadata }
  };
}

async function migrateMemorization() {
  const html = await readFile(sourcePaths.memorization, "utf8");
  const cards = ["baseCards", "extraCards", "masteryCards"].flatMap(name => literalArray(html, name));
  const statements = ["judgeStatements", "advancedJudgeStatements"].flatMap(name => literalArray(html, name));
  const resources = cards.map(card => ({
    id: `concept:${card.id}`, kind: "concept", title: card.term, text: card.clue,
    pair: card.pair, trap: card.trap, stage: card.stage, importance: importance(card.importance),
    source: source("政経/memorization_game/index.html", { legacyId: card.id })
  }));
  const exercises = [
    ...cards.map(card => ({
      id: `concept-input:${card.id}`, resourceId: `concept:${card.id}`, type: "text-input", importance: importance(card.importance),
      payload: { prompt: card.clue, acceptedAnswers: [card.term], explanation: card.trap, pair: card.pair },
      source: source("政経/memorization_game/index.html", { legacyId: card.id, legacyMode: "type" })
    })),
    ...statements.map(statement => ({
      id: `judge:${statement.id}`, type: "true-false", importance: importance(statement.importance),
      payload: { statement: statement.statement, answer: statement.answer, explanation: statement.explain },
      source: source("政経/memorization_game/index.html", { legacyId: statement.id, legacyMode: "judge" })
    }))
  ];
  return { pack: makePack({
    id: "seikei-memorization", title: "政経 暗記カード・正誤", subject: { id: "politics-economics", name: "政治・経済" }, resources, exercises,
    metadata: { legacyCounts: { concepts: cards.length, trueFalse: statements.length }, sourceFiles: ["政経/memorization_game/index.html"] }
  }), counts: { concepts: cards.length, trueFalse: statements.length }, raw: { cards, statements } };
}

function inorganicExercise(question) {
  const common = {
    id: `question:${question.id}`, importance: question.difficulty >= 3 ? "A" : question.difficulty === 2 ? "B" : "C",
    source: source("無機化学/data/questions.json", { legacyId: question.id, legacyFormat: question.format }),
    metadata: { unit: question.unit, topic: question.topic, tags: question.tags, related: question.related, caution: question.caution }
  };
  const explanation = question.explanation;
  if (["identify", "single", "analysis"].includes(question.format)) return {
    ...common, type: "single-choice", payload: { prompt: question.prompt, options: question.options, correctOptionId: question.answers[0], explanation }
  };
  if (question.format === "multiple") return {
    ...common, type: "multiple-choice", payload: { prompt: question.prompt, options: question.options, correctOptionIds: question.answers, explanation }
  };
  if (question.format === "truefalse") return {
    ...common, type: "true-false", payload: { statement: question.prompt, answer: question.answers[0] === "true", explanation }
  };
  if (["short", "equation"].includes(question.format)) return {
    ...common, type: "text-input", payload: { prompt: question.prompt, acceptedAnswers: question.answers, explanation }
  };
  throw new Error(`未対応の無機化学 format: ${question.format}`);
}

async function migrateInorganic() {
  const legacy = await readJson(sourcePaths.inorganic);
  const questions = legacy.questions;
  return { pack: makePack({
    id: "inorganic-chemistry", title: "無機化学ラボ", subject: { id: "chemistry", name: "化学" }, resources: [], exercises: questions.map(inorganicExercise),
    metadata: { sourceFormatVersion: legacy.formatVersion, legacyCounts: { questions: questions.length }, sourceFiles: ["無機化学/data/questions.json"] }
  }), counts: { questions: questions.length, formats: Object.fromEntries(Object.entries(Object.groupBy(questions, question => question.format)).map(([key, values]) => [key, values.length])) }, raw: { questions } };
}

async function migrateConstitution() {
  const base = sourcePaths.constitution;
  const [articles, blanks, chapters, stages, summaries] = await Promise.all([
    readJson(resolve(base, "articles.json")), readJson(resolve(base, "blanks.json")), readJson(resolve(base, "chapters.json")),
    readJson(resolve(base, "stages.json")), readJson(resolve(base, "summary_questions.json"))
  ]);
  const articleResources = articles.map(article => ({
    id: `article:${article.id}`, kind: "constitution-article", title: article.heading, text: article.text, normalizedText: article.normalizedText,
    segments: article.segments, chapterId: article.chapterId, articleNumber: article.articleNumber,
    source: source("政経/constitution-quest/data/articles.json", { legacyId: article.id, officialSource: article.source, sourcePages: article.sourcePages })
  }));
  const chapterResources = chapters.map(chapter => ({ ...chapter, id: `chapter:${chapter.id}`, kind: "constitution-chapter", source: source("政経/constitution-quest/data/chapters.json", { legacyId: chapter.id }) }));
  const stageResources = stages.map(stage => ({ ...stage, id: `stage:${stage.id}`, kind: "constitution-stage", source: source("政経/constitution-quest/data/stages.json", { legacyId: stage.id }) }));
  const articleByNumber = new Map(articles.map(article => [article.articleNumber, article]));
  const cloze = item => ({
    id: `cloze:${item.id}`, resourceId: `article:${articleByNumber.get(item.articleNumber)?.id ?? "preamble"}`, type: "cloze", importance: item.difficulty >= 3 ? "A" : item.difficulty === 2 ? "B" : "C",
    payload: { before: item.before, answer: item.answer, after: item.after, acceptedAnswers: item.acceptedAnswers, explanation: item.heading },
    source: source("政経/constitution-quest/data/blanks.json", { legacyId: item.id, sourcePage: item.sourcePage, sourceKind: item.sourceKind, reviewed: item.reviewed, tags: item.tags })
  });
  const summary = item => ({
    id: `summary-cloze:${item.id}`, type: "cloze", importance: item.difficulty >= 3 ? "A" : item.difficulty === 2 ? "B" : "C",
    payload: { before: item.before, answer: item.answer, after: item.after, acceptedAnswers: item.acceptedAnswers, explanation: item.heading },
    source: source("政経/constitution-quest/data/summary_questions.json", { legacyId: item.id, sourcePage: item.sourcePage, sourceKind: item.sourceKind, verificationSource: item.verificationSource, reviewed: item.reviewed, tags: item.tags })
  });
  const recall = article => ({
    id: `full-recall:${article.id}`, resourceId: `article:${article.id}`, type: "full-recall", importance: "A",
    payload: { prompt: `${article.heading}（${article.articleNumber ? `第${article.articleNumber}条` : "前文"}）を頭の中で全文再現してから、答えを表示してください。`, acceptedAnswers: [article.text, article.normalizedText], explanation: "条文本文を資料からそのまま保持しています。" },
    source: source("政経/constitution-quest/data/articles.json", { legacyId: article.id, derived: true, officialSource: article.source, sourcePages: article.sourcePages })
  });
  return { pack: makePack({
    id: "constitution-quest", title: "日本国憲法クエスト", subject: { id: "politics", name: "政治" }, resources: [...articleResources, ...chapterResources, ...stageResources], exercises: [...blanks.map(cloze), ...summaries.map(summary), ...articles.map(recall)],
    metadata: { legacyCounts: { articles: articles.length, chapters: chapters.length, stages: stages.length, blanks: blanks.length, summaryCloze: summaries.length, derivedFullRecall: articles.length }, sourceFiles: ["政経/constitution-quest/data/articles.json", "政経/constitution-quest/data/blanks.json", "政経/constitution-quest/data/chapters.json", "政経/constitution-quest/data/stages.json", "政経/constitution-quest/data/summary_questions.json"] }
  }), counts: { articles: articles.length, chapters: chapters.length, stages: stages.length, blanks: blanks.length, summaryCloze: summaries.length, fullRecall: articles.length }, raw: { articles, blanks, chapters, stages, summaries } };
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function idsUnique(items, label) { assert(new Set(items.map(item => item.id)).size === items.length, `${label} IDが重複しています`); }
function sameJson(actual, expected, message) { assert(JSON.stringify(actual) === JSON.stringify(expected), message); }
function verifyMemorization(raw, pack) {
  const resourceMap = new Map(pack.resources.map(item => [item.id, item]));
  const exerciseMap = new Map(pack.exercises.map(item => [item.id, item]));
  raw.cards.forEach(card => {
    const resource = resourceMap.get(`concept:${card.id}`);
    const exercise = exerciseMap.get(`concept-input:${card.id}`);
    assert(resource && exercise, `政経concept ${card.id} が欠落しています`);
    sameJson([resource.title, resource.text, resource.pair, resource.trap, resource.stage, resource.importance], [card.term, card.clue, card.pair, card.trap, card.stage, importance(card.importance)], `政経concept ${card.id} の意味が変化しています`);
    sameJson([exercise.payload.prompt, exercise.payload.acceptedAnswers, exercise.payload.explanation, exercise.payload.pair], [card.clue, [card.term], card.trap, card.pair], `政経concept exercise ${card.id} が変化しています`);
  });
  raw.statements.forEach(statement => {
    const exercise = exerciseMap.get(`judge:${statement.id}`);
    assert(exercise, `政経judge ${statement.id} が欠落しています`);
    sameJson([exercise.payload.statement, exercise.payload.answer, exercise.payload.explanation, exercise.importance], [statement.statement, statement.answer, statement.explain, importance(statement.importance)], `政経judge ${statement.id} が変化しています`);
  });
}
function verifyInorganic(raw, pack) {
  const exerciseMap = new Map(pack.exercises.map(item => [item.id, item]));
  const typeFor = format => ["identify", "single", "analysis"].includes(format) ? "single-choice" : format === "multiple" ? "multiple-choice" : format === "truefalse" ? "true-false" : "text-input";
  raw.questions.forEach(question => {
    const exercise = exerciseMap.get(`question:${question.id}`);
    assert(exercise, `無機化学 ${question.id} が欠落しています`);
    assert(exercise.type === typeFor(question.format), `無機化学 ${question.id} のtypeが不正です`);
    assert(exercise.payload.explanation === question.explanation, `無機化学 ${question.id} のexplanationが変化しています`);
    if (exercise.type === "single-choice") sameJson([exercise.payload.options, exercise.payload.correctOptionId], [question.options, question.answers[0]], `無機化学 ${question.id} のchoiceが変化しています`);
    if (exercise.type === "multiple-choice") sameJson([exercise.payload.options, exercise.payload.correctOptionIds], [question.options, question.answers], `無機化学 ${question.id} のmultipleが変化しています`);
    if (exercise.type === "true-false") assert(exercise.payload.answer === (question.answers[0] === "true"), `無機化学 ${question.id} の真偽値が変化しています`);
    if (exercise.type === "text-input") sameJson(exercise.payload.acceptedAnswers, question.answers, `無機化学 ${question.id} のacceptedAnswersが変化しています`);
  });
}
function verifyConstitution(raw, pack) {
  const blankIds = new Set(raw.blanks.map(item => item.id));
  const segmentIds = raw.articles.flatMap(article => (article.segments || []).filter(segment => segment.type === "blank").map(segment => segment.blankId));
  idsUnique(raw.articles, "憲法 articles"); idsUnique(raw.blanks, "憲法 blanks"); idsUnique(raw.chapters, "憲法 chapters"); idsUnique(raw.stages, "憲法 stages");
  assert(segmentIds.length === raw.blanks.length, `segments blank数 ${segmentIds.length} != blanks ${raw.blanks.length}`);
  assert(new Set(segmentIds).size === segmentIds.length, "segments 内の blankId が重複しています");
  assert([...blankIds].every(id => segmentIds.includes(id)), "blanks と article.segments が1:1ではありません");
  raw.blanks.forEach(blank => {
    const article = raw.articles.find(item => item.articleNumber === blank.articleNumber);
    assert(article, `blank ${blank.id} の条文参照がありません`);
    assert(article.segments.some(segment => segment.blankId === blank.id), `blank ${blank.id} がsegmentsにありません`);
  });
  assert(pack.resources.filter(item => item.kind === "constitution-article").length === 104, "article resource数が104ではありません");
  const resourceMap = new Map(pack.resources.map(item => [item.id, item]));
  const exerciseMap = new Map(pack.exercises.map(item => [item.id, item]));
  raw.articles.forEach(article => {
    const resource = resourceMap.get(`article:${article.id}`);
    const recall = exerciseMap.get(`full-recall:${article.id}`);
    assert(resource && recall, `憲法article ${article.id} が欠落しています`);
    sameJson([resource.text, resource.normalizedText, resource.segments, resource.chapterId, resource.articleNumber], [article.text, article.normalizedText, article.segments, article.chapterId, article.articleNumber], `憲法article ${article.id} が変化しています`);
    sameJson(recall.payload.acceptedAnswers, [article.text, article.normalizedText], `憲法full recall ${article.id} が変化しています`);
  });
  raw.blanks.forEach(blank => {
    const exercise = exerciseMap.get(`cloze:${blank.id}`);
    assert(exercise, `憲法blank ${blank.id} が欠落しています`);
    sameJson([exercise.payload.before, exercise.payload.answer, exercise.payload.after, exercise.payload.acceptedAnswers], [blank.before, blank.answer, blank.after, blank.acceptedAnswers], `憲法blank ${blank.id} が変化しています`);
  });
  raw.summaries.forEach(summary => {
    const exercise = exerciseMap.get(`summary-cloze:${summary.id}`);
    assert(exercise, `憲法summary ${summary.id} が欠落しています`);
    sameJson([exercise.payload.before, exercise.payload.answer, exercise.payload.after, exercise.payload.acceptedAnswers], [summary.before, summary.answer, summary.after, summary.acceptedAnswers], `憲法summary ${summary.id} が変化しています`);
  });
}
function verifyBundle(bundle, results) {
  assert(bundle.packs.length === 3, "pack数が3ではありません");
  idsUnique(bundle.packs, "pack");
  bundle.packs.forEach(pack => {
    const validation = validatePack(pack);
    assert(validation.valid, `${pack.id} がschema不正: ${validation.errors.map(item => `${item.path}: ${item.message}`).join("; ")}`);
    idsUnique(pack.resources, `${pack.id} resource`); idsUnique(pack.exercises, `${pack.id} exercise`);
    const refs = new Set(pack.resources.map(resource => resource.id));
    pack.exercises.filter(exercise => exercise.resourceId).forEach(exercise => assert(refs.has(exercise.resourceId), `${pack.id}/${exercise.id} のresource参照が不正です`));
  });
  assert(results.memorization.counts.concepts === 196, `政経concept数 ${results.memorization.counts.concepts} != 196`);
  assert(results.memorization.counts.trueFalse === 232, `政経true-false数 ${results.memorization.counts.trueFalse} != 232`);
  assert(results.inorganic.counts.questions === 26, `無機化学数 ${results.inorganic.counts.questions} != 26`);
  assert(results.constitution.counts.blanks === 280 && results.constitution.counts.summaryCloze === 8, "憲法cloze数が不正です");
  assert(results.constitution.counts.articles === 104 && results.constitution.counts.chapters === 13 && results.constitution.counts.stages === 13, "憲法resource数が不正です");
  verifyMemorization(results.memorization.raw, results.memorization.pack);
  verifyInorganic(results.inorganic.raw, results.inorganic.pack);
  verifyConstitution(results.constitution.raw, results.constitution.pack);
}

const memorization = await migrateMemorization();
const inorganic = await migrateInorganic();
const constitution = await migrateConstitution();
const results = { memorization, inorganic, constitution };
const bundle = { schemaVersion: 1, type: "builtin-memory-packs", generatedAt: "2026-08-20T00:00:00.000Z", packs: [memorization.pack, inorganic.pack, constitution.pack] };
verifyBundle(bundle, results);
await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: "data/builtin-packs.json", packs: 3, memorization: memorization.counts, inorganic: inorganic.counts, constitution: constitution.counts }, null, 2));
