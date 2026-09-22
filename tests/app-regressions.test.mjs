import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as core from "../src/core.js";
import * as game from "../src/game.js";
import * as registry from "../src/exercise-registry.js";
import * as library from "../src/library.js";
import * as mock from "../src/constitution-mock.js";
import * as storage from "../src/storage.js";

const bundle = JSON.parse(await readFile(new URL("../data/builtin-packs.json", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/app.js", import.meta.url), "utf8"))
  .replace(/^import\s[\s\S]*?from\s+"[^"\n]+";\s*/gm, "")
  .replace(/^init\(\);\s*$/m, "");
const plain = value => JSON.parse(JSON.stringify(value));
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// A small DOM boundary: replacing innerHTML destroys old inputs, as a browser does.
// All rendering, grading, navigation, persistence and draft logic runs from app.js.
function harness() {
  let html = "";
  let inputs = [];
  const node = () => ({ addEventListener() {}, classList: { add() {}, remove() {} }, focus() {} });
  const app = {
    ...node(),
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      inputs = [...value.matchAll(/<input\b([^>]*)>/g)].map(([, attributes]) => {
        const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, val]) => [key, decode(val)]));
        return { ...node(), ...attrs, value: attrs.value || "", type: attrs.type || "text", checked: /\bchecked\b/.test(attributes) };
      });
    }
  };
  const toast = node();
  const modal = node();
  const document = {
    addEventListener() {},
    createTextNode: value => value,
    querySelectorAll(selector) {
      if (selector === "#article-rebuild-form input") return inputs.filter(input => input.name?.startsWith("cloze:"));
      if (selector === "input[name=answer]:checked") return inputs.filter(input => input.name === "answer" && input.checked);
      if (selector === "input[name=answer]") return inputs.filter(input => input.name === "answer");
      return [];
    },
    querySelector(selector) {
      if (selector === "#app") return app;
      if (selector === "#toast") return toast;
      if (selector === "#modal") return modal;
      if (selector === "#answer-input, input[name=answer]") return inputs.find(input => input.name === "answer");
      return this.querySelectorAll(selector)[0] || null;
    }
  };
  const saved = new Map();
  const writes = [];
  let fail = false;
  const context = vm.createContext({
    ...core, ...game, ...registry, ...library, ...mock, ...storage,
    document, window: { addEventListener() {}, scrollTo() {} }, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: callback => callback(),
    sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    FormData: class { constructor(values) { this.values = values; } get(key) { return this.values[key]; } },
    recordAttempts: async (_db, attempts, meta) => {
      if (fail) throw new Error("simulated batch transaction failure");
      writes.push(plain({ attempts, meta }));
    }
  });
  vm.runInContext(source, context, { filename: "src/app.js" });
  context.fixture = structuredClone(bundle.packs);
  vm.runInContext("snapshot = { meta: { custom: 'keep', game: normalizeGameState({ xp: 17 }) }, packs: fixture, progress: [], history: [] };", context);
  return {
    run: code => vm.runInContext(code, context),
    inject: (key, value) => { context[key] = value; },
    get html() { return html; },
    get inputs() { return inputs; },
    get writes() { return writes; },
    fail(value) { fail = value; },
    state: () => plain(vm.runInContext("({ snapshot, progress: [...progressMap], session, mockSession, currentView })", context))
  };
}

test("all 196 politics input questions hide their answer-bearing resource title before answering", () => {
  const app = harness();
  const pack = bundle.packs.find(pack => pack.id === "seikei-memorization");
  const questions = pack.exercises.filter(exercise => exercise.type === "text-input");
  assert.equal(questions.length, 196);
  for (const exercise of questions) {
    app.inject("exercise", exercise);
    app.run('beginSession("seikei-memorization", "strict", [exercise])');
    const resource = pack.resources.find(resource => resource.id === exercise.resourceId);
    const meta = app.html.match(/<div class="question-meta">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(meta, exercise.id);
    assert.ok(!decode(meta).includes(resource.title), `${exercise.id} leaks ${resource.title}`);
  }
});

test("opening a hint preserves unfinished text in the newly rendered input", () => {
  const app = harness();
  app.run('beginSession("seikei-memorization", "library", [packById("seikei-memorization").exercises.find(e => e.type === "text-input")])');
  const oldInput = app.inputs.find(input => input.name === "answer");
  oldInput.value = "入力途中<&";
  app.run("showHint()");
  assert.notEqual(app.inputs.find(input => input.name === "answer"), oldInput);
  assert.equal(app.inputs.find(input => input.name === "answer").value, "入力途中<&");
  assert.equal(app.state().session.usedHint, true);
  assert.ok(app.html.includes('class="hint-box"'));
});

for (const kind of ["input", "choice", "puzzle", "article"]) {
  test(`${kind} draft survives home navigation, resume and session restoration`, () => {
    const app = harness();
    if (kind === "article") {
      app.run('startArticleRebuild("constitution-quest")');
      app.inputs[0].value = "条文の途中<&";
    } else {
      app.run(`beginSession("seikei-memorization", "${kind === "puzzle" ? "puzzle" : kind === "choice" ? "recognition" : "strict"}", [packById("seikei-memorization").exercises.find(e => e.type === "text-input")])`);
      if (kind === "input") app.inputs.find(input => input.name === "answer").value = "途中回答<&";
      if (kind === "choice") app.inputs.filter(input => input.name === "answer")[1].checked = true;
      if (kind === "puzzle") app.run("session.puzzleSelected.push(session.puzzleTiles[0].id); renderStudy()");
    }
    const expected = kind === "article" ? { name: app.inputs[0].name, value: app.inputs[0].value }
      : kind === "choice" ? app.inputs.find(input => input.checked).value
        : kind === "input" ? app.inputs.find(input => input.name === "answer").value : app.state().session.puzzleSelected;
    const verifyDraft = () => {
      assert.equal(app.state().currentView, "study");
      if (kind === "article") assert.equal(app.inputs.find(input => input.name === expected.name).value, expected.value);
      else if (kind === "choice") assert.equal(app.inputs.find(input => input.checked)?.value, expected);
      else if (kind === "input") assert.equal(app.inputs.find(input => input.name === "answer").value, expected);
      else assert.deepEqual(app.state().session.puzzleSelected, expected);
    };
    app.run('navigate("home")');
    assert.equal(app.state().currentView, "home");
    assert.ok(app.html.includes('data-action="resume-study"'));
    app.run("resumeStudy()");
    verifyDraft();
    app.run('navigate("home"); session = null; session = restoreStudySession(); resumeStudy()');
    verifyDraft();
  });
}

for (const kind of ["mock", "article"]) {
  test(`${kind} failed batch preserves memory and retry records each answer once`, async () => {
    const app = harness();
    if (kind === "mock") {
      app.run(`{
        const pack = packById("constitution-quest");
        const chosen = pack.exercises.filter(e => e.type === "cloze").slice(0, 3);
        mockSession = { packId: pack.id, selectedExerciseIds: chosen.map(e => e.id),
          responses: Object.fromEntries(chosen.map(e => [e.id, firstAcceptedAnswer(e)])),
          startedAt: Date.now(), endsAt: Date.now() + 900000, completed: false };
      }`);
    } else {
      app.run('startArticleRebuild("constitution-quest")');
      app.inject("form", app.run('Object.fromEntries(session.articleExerciseIds.map(id => [id, firstAcceptedAnswer(exerciseById(packById(session.packId), id))]))'));
    }
    const before = app.state();
    const call = kind === "mock" ? "submitConstitutionMock()" : "submitArticleRebuild(form)";
    app.fail(true);
    await app.run(call);
    const failed = app.state();
    assert.deepEqual(failed.snapshot, before.snapshot);
    assert.deepEqual(failed.progress, before.progress);
    assert.equal(app.writes.length, 0);
    if (kind === "mock") {
      assert.equal(failed.mockSession.completed, false);
      assert.deepEqual(failed.mockSession.responses, before.mockSession.responses);
    } else {
      for (const key of ["articleResult", "correct", "wrong", "answered", "combo", "bestCombo", "xpEarned"]) assert.deepEqual(failed.session[key], before.session[key], key);
    }
    app.fail(false);
    await app.run(call);
    const after = app.state();
    const count = kind === "mock" ? before.mockSession.selectedExerciseIds.length : before.session.articleExerciseIds.length;
    assert.equal(app.writes.length, 1);
    assert.equal(app.writes[0].attempts.length, count);
    assert.equal(after.snapshot.history.length, count);
    assert.equal(after.snapshot.progress.length, count);
    assert.ok(after.snapshot.progress.every(progress => progress.attempts === 1));
    assert.equal(after.snapshot.meta.custom, "keep");
    assert.equal(after.snapshot.meta.game.xp, 17 + (kind === "mock" ? count * 5 : 8));
  });
}

test("home places materials before game modes and labels the daily quest with its pack", () => {
  const app = harness();
  app.run("renderHome()");
  assert.ok(app.html.indexOf('class="pack-grid"') < app.html.indexOf('class="game-hero"'));
  assert.ok(app.html.includes(`class="daily-pack-name">${core.escapeHtml(bundle.packs[0].title)}</p>`));
});

test("expired mock answers stay locked after a failed save", () => {
  const app = harness();
  app.run(`mockSession = {
    packId: "constitution-quest", responses: { "cloze:retained": "提出時の回答" },
    endsAt: Date.now() - 1, completed: false, submitting: false, saveFailed: true
  }`);
  const before = app.state().mockSession.responses;
  app.run(`handleMockInput({ target: { closest: () => ({
    dataset: { mockInput: "cloze:retained" }, value: "期限後に変更した回答"
  }) } })`);
  assert.deepEqual(app.state().mockSession.responses, before);
  const html = app.run('mockArticleSegment({ type: "input", exerciseId: "cloze:retained" }, packById("constitution-quest"))');
  assert.match(html, /\sreadonly(?:\s|>)/);
  assert.ok(html.includes('value="提出時の回答"'));
});
