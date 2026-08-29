import { APP_VERSION, BACKUP_TYPE, SCHEMA_VERSION, progressKey, validateBackup, validatePack } from "./core.js?v=1.4.0";

const DB_NAME = "memory-foundry";
const DB_VERSION = 1;
const META = "meta";
const PACKS = "packs";
const PROGRESS = "progress";
const HISTORY = "history";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

export async function openStorage() {
  if (!globalThis.indexedDB) throw new Error("このブラウザーではIndexedDBを利用できません");
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: "id" });
    if (!db.objectStoreNames.contains(PROGRESS)) {
      const store = db.createObjectStore(PROGRESS, { keyPath: "key" });
      store.createIndex("packId", "packId", { unique: false });
    }
    if (!db.objectStoreNames.contains(HISTORY)) {
      const store = db.createObjectStore(HISTORY, { keyPath: "id" });
      store.createIndex("packId", "packId", { unique: false });
      store.createIndex("attemptedAt", "attemptedAt", { unique: false });
    }
  };
  return requestResult(request);
}

export async function loadAll(db) {
  const transaction = db.transaction([META, PACKS, PROGRESS, HISTORY], "readonly");
  const meta = await requestResult(transaction.objectStore(META).get("app"));
  const packs = await requestResult(transaction.objectStore(PACKS).getAll());
  const progress = await requestResult(transaction.objectStore(PROGRESS).getAll());
  const history = await requestResult(transaction.objectStore(HISTORY).getAll());
  await transactionDone(transaction);
  return {
    meta: meta || { schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, builtinVersions: {} },
    packs,
    progress,
    history: history.sort((a, b) => b.attemptedAt - a.attemptedAt)
  };
}

export async function putPack(db, pack) {
  const validation = validatePack(pack);
  if (!validation.valid) throw new Error(validation.errors[0].message);
  const transaction = db.transaction(PACKS, "readwrite");
  transaction.objectStore(PACKS).put(pack);
  await transactionDone(transaction);
}

export async function putMeta(db, meta) {
  const transaction = db.transaction(META, "readwrite");
  transaction.objectStore(META).put(meta, "app");
  await transactionDone(transaction);
}

export async function putProgress(db, record) {
  const expectedKey = progressKey(record.packId, record.exerciseId);
  if (!record || record.key !== expectedKey) throw new Error("progress identityが一致しません");
  const transaction = db.transaction(PROGRESS, "readwrite");
  transaction.objectStore(PROGRESS).put(record);
  await transactionDone(transaction);
}

export async function addHistory(db, entry) {
  const transaction = db.transaction(HISTORY, "readwrite");
  transaction.objectStore(HISTORY).put(entry);
  await transactionDone(transaction);
}

export async function recordAttempt(db, progressRecord, historyEntry) {
  const expectedKey = progressKey(progressRecord.packId, progressRecord.exerciseId);
  if (progressRecord.key !== expectedKey) throw new Error("progress identityが一致しません");
  if (historyEntry.packId !== progressRecord.packId || historyEntry.exerciseId !== progressRecord.exerciseId) {
    throw new Error("history identityがprogressと一致しません");
  }
  const transaction = db.transaction([PROGRESS, HISTORY], "readwrite");
  transaction.objectStore(PROGRESS).put(progressRecord);
  transaction.objectStore(HISTORY).put(historyEntry);
  await transactionDone(transaction);
}

export async function deletePackCompletely(db, packId) {
  const transaction = db.transaction([PACKS, PROGRESS, HISTORY], "readwrite");
  transaction.objectStore(PACKS).delete(packId);
  for (const storeName of [PROGRESS, HISTORY]) {
    const store = transaction.objectStore(storeName);
    const index = store.index("packId");
    const request = index.openKeyCursor(IDBKeyRange.only(packId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await transactionDone(transaction);
}

export function createBackup(snapshot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    type: BACKUP_TYPE,
    exportedAt: new Date().toISOString(),
    metadata: { packCount: snapshot.packs.length, progressCount: snapshot.progress.length, historyCount: snapshot.history.length },
    meta: snapshot.meta,
    packs: snapshot.packs,
    progress: snapshot.progress,
    history: snapshot.history
  };
}

export async function replaceFromBackup(db, backup) {
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(validation.errors.map(error => `${error.path}: ${error.message}`).slice(0, 5).join("\n"));
  const transaction = db.transaction([META, PACKS, PROGRESS, HISTORY], "readwrite");
  const metaStore = transaction.objectStore(META);
  const packStore = transaction.objectStore(PACKS);
  const progressStore = transaction.objectStore(PROGRESS);
  const historyStore = transaction.objectStore(HISTORY);
  metaStore.clear(); packStore.clear(); progressStore.clear(); historyStore.clear();
  metaStore.put({ ...(backup.meta || {}), schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION }, "app");
  backup.packs.forEach(pack => packStore.put(pack));
  backup.progress.forEach(record => progressStore.put(record));
  backup.history.forEach(entry => historyStore.put(entry));
  await transactionDone(transaction);
}

export async function syncBuiltinPacks(db, builtinBundle, existingPacks, meta) {
  const nextMeta = { ...meta, builtinVersions: { ...(meta.builtinVersions || {}) }, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION };
  const existingMap = new Map(existingPacks.map(pack => [pack.id, pack]));
  let changed = false;
  const writes = [];
  for (const builtin of builtinBundle.packs) {
    const validation = validatePack(builtin);
    if (!validation.valid) throw new Error(`組み込み教材 ${builtin.id}: ${validation.errors[0].message}`);
    const installed = existingMap.get(builtin.id);
    const version = builtin.metadata?.contentVersion || builtinBundle.generatedAt || "1";
    const previousVersion = nextMeta.builtinVersions[builtin.id];
    if (!installed) {
      existingMap.set(builtin.id, builtin);
      writes.push(builtin);
      changed = true;
    } else if (previousVersion !== version && !installed.metadata?.userEdited) {
      const updated = { ...builtin, status: installed.status, createdAt: installed.createdAt || builtin.createdAt };
      existingMap.set(builtin.id, updated);
      writes.push(updated);
      changed = true;
    }
    nextMeta.builtinVersions[builtin.id] = version;
  }
  const transaction = db.transaction([PACKS, META], "readwrite");
  const packStore = transaction.objectStore(PACKS);
  writes.forEach(pack => packStore.put(pack));
  transaction.objectStore(META).put(nextMeta, "app");
  await transactionDone(transaction);
  return { packs: [...existingMap.values()], meta: nextMeta, changed };
}
