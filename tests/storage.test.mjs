import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createBackup,
  deletePackCompletely,
  loadAll,
  recordAttempt,
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

function memoryDb() {
  const stores = Object.fromEntries(["meta", "packs", "progress", "history"].map(name => [name, new Map()]));
  const transactions = [];
  return {
    stores,
    transactions,
    transaction(names, mode) {
      const selected = Array.isArray(names) ? names : [names];
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: name => new MemoryStore(name, stores[name]) };
      transactions.push({ names: selected, mode });
      setTimeout(() => tx.oncomplete?.(), 0);
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

test("backup restore round-trip keeps archived pack, progress and history", async () => {
  const db = memoryDb();
  const archived = { ...pack, status: "archived" };
  const backup = createBackup({ meta: { builtinVersions: {} }, packs: [archived], progress: [progress], history: [history] });
  await replaceFromBackup(db, backup);
  const restored = await loadAll(db);
  assert.equal(restored.packs[0].status, "archived");
  assert.equal(restored.progress[0].key, progress.key);
  assert.equal(restored.history[0].id, history.id);
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

