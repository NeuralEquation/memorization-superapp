import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createBackup,
  deletePackCompletely,
  loadAll,
  recordAttempt,
  recordAttempts,
  replaceFromBackup
} from "../src/storage.js";
import { emptyProgress } from "../src/core.js";

class MemoryStore {
  constructor(name, data) { this.name = name; this.data = data; }
  keyFor(value, key) {
    if (key != null) return key;
    return this.name === "packs" ? value.id : this.name === "progress" ? value.key : value.id;
  }
  put(value, key) { this.data.set(this.keyFor(value, key), structuredClone(value)); }
  get(key) { return request(() => structuredClone(this.data.get(key))); }
  getAll() { return request(() => [...this.data.values()].map(value => structuredClone(value))); }
  clear() { this.data.clear(); }
  delete(key) { this.data.delete(key); }
  index(field) {
    return {
      openKeyCursor: value => cursorRequest([...this.data.entries()].filter(([, item]) => item[field] === value).map(([key]) => key))
    };
  }
}

function request(read) {
  const output = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try { output.result = read(); output.onsuccess?.(); }
    catch (error) { output.error = error; output.onerror?.(); }
  });
  return output;
}

function cursorRequest(keys) {
  const output = { result: undefined, error: null, onsuccess: null, onerror: null };
  let index = 0;
  const advance = () => queueMicrotask(() => {
    output.result = index < keys.length
      ? { primaryKey: keys[index++], continue: advance }
      : null;
    output.onsuccess?.();
  });
  advance();
  return output;
}

function memoryDb({ failPut = 0, abortAtCommit = false } = {}) {
  const stores = Object.fromEntries(["meta", "packs", "progress", "history"].map(name => [name, new Map()]));
  const transactions = [];
  return {
    stores,
    transactions,
    transaction(names, mode) {
      const selected = Array.isArray(names) ? names : [names];
      const staged = Object.fromEntries(selected.map(name => [name, new Map(stores[name])]));
      let aborted = false;
      let writes = 0;
      const tx = {
        oncomplete: null, onerror: null, onabort: null, error: null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name) {
          const store = new MemoryStore(name, staged[name]);
          const put = store.put.bind(store);
          store.put = (value, key) => {
            if (++writes === failPut) throw new Error("simulated put failure");
            put(value, key);
          };
          return store;
        }
      };
      transactions.push({ names: selected, mode });
      setTimeout(() => {
        if (aborted) return;
        if (abortAtCommit) { tx.error = new Error("simulated transaction failure"); tx.abort(); return; }
        if (mode === "readwrite") selected.forEach(name => { stores[name] = staged[name]; });
        tx.oncomplete?.();
      }, 0);
      return tx;
    }
  };
}

const bundle = JSON.parse(await readFile(new URL("../data/builtin-packs.json", import.meta.url), "utf8"));
const pack = structuredClone(bundle.packs[1]);
const exercise = pack.exercises[0];
const progress = { ...emptyProgress(pack.id, exercise.id), attempts: 1, correct: 1, strength: 0.4, dueAt: Date.now() + 1_000 };
const history = { id: "attempt-1", packId: pack.id, exerciseId: exercise.id, interactionType: exercise.type, correct: true, attemptedAt: Date.now() };

test("recordAttempt uses one readwrite transaction for progress and history", async () => {
  const db = memoryDb();
  await recordAttempt(db, progress, history);
  assert.deepEqual(db.transactions[0], { names: ["progress", "history"], mode: "readwrite" });
  assert.equal(db.stores.progress.size, 1);
  assert.equal(db.stores.history.size, 1);
});

test("batch answers roll back every store on synchronous or transaction failure", async () => {
  const secondExercise = pack.exercises[1];
  const attempts = [
    { progress, history },
    { progress: { ...emptyProgress(pack.id, secondExercise.id), attempts: 1 }, history: { ...history, id: "attempt-2", exerciseId: secondExercise.id } }
  ];
  for (const options of [{ failPut: 3 }, { abortAtCommit: true }]) {
    const db = memoryDb(options);
    db.stores.meta.set("app", { game: { xp: 10 } });
    await assert.rejects(recordAttempts(db, attempts, { game: { xp: 50 } }), /failure/);
    assert.equal(db.stores.progress.size, 0);
    assert.equal(db.stores.history.size, 0);
    assert.equal(db.stores.meta.get("app").game.xp, 10);
    assert.equal(db.transactions.length, 1);
  }
  const db = memoryDb();
  await recordAttempts(db, attempts, { game: { xp: 50 } });
  assert.equal(db.transactions.length, 1);
  assert.equal(db.stores.progress.size, 2);
  assert.equal(db.stores.history.size, 2);
  assert.equal(db.stores.meta.get("app").game.xp, 50);
});

test("game progress is committed atomically with an answered question", async () => {
  const db = memoryDb();
  const meta = { builtinVersions: {}, game: { xp: 25, totalCorrect: 1, bestCombo: 1, dailyStreak: 1, lastActiveDate: "2026-08-30", bossClears: {} } };
  await recordAttempt(db, progress, { ...history, id: "attempt-game" }, meta);
  assert.deepEqual(db.transactions[0], { names: ["meta", "progress", "history"], mode: "readwrite" });
  assert.equal(db.stores.meta.size, 1);
  const restored = await loadAll(db);
  assert.equal(restored.meta.game.xp, 25);
});

test("backup restore round-trip keeps archived pack, progress and history", async () => {
  const db = memoryDb();
  const archived = { ...pack, status: "archived" };
  const backup = createBackup({ meta: { builtinVersions: {}, game: { xp: 500, bossClears: { [pack.id]: { "area:test": { stars: 3, rate: 1 } } } } }, packs: [archived], progress: [progress], history: [history] });
  await replaceFromBackup(db, backup);
  const restored = await loadAll(db);
  assert.equal(restored.packs[0].status, "archived");
  assert.equal(restored.progress[0].key, progress.key);
  assert.equal(restored.history[0].id, history.id);
  assert.equal(restored.meta.game.xp, 500);
  assert.equal(restored.meta.game.bossClears[pack.id]["area:test"].stars, 3);
});

test("complete pack deletion cascades to progress and history", async () => {
  const db = memoryDb();
  db.stores.packs.set(pack.id, pack);
  db.stores.progress.set(progress.key, progress);
  db.stores.history.set(history.id, history);
  globalThis.IDBKeyRange = { only: value => value };
  await deletePackCompletely(db, pack.id);
  assert.equal(db.stores.packs.size, 0);
  assert.equal(db.stores.progress.size, 0);
  assert.equal(db.stores.history.size, 0);
});
