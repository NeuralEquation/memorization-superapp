import { EXERCISE_TYPES, getExerciseTypeDefinition } from "./exercise-types.js?v=1.2.0";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "1.2.0";
export const PACK_TYPE = "memory-pack";
export const BACKUP_TYPE = "memory-foundry-backup";

export const SUPPORTED_EXERCISE_TYPES = Object.freeze(Object.keys(EXERCISE_TYPES));

const DAY = 86_400_000;
const MINUTE = 60_000;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s\u3000、。，．,.・･「」『』（）()［］\[\]{}]/g, "")
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function renderPlainText(value) {
  return escapeHtml(value)
    .replace(/([（(][^（）()\n<>]{1,14}[）)])/g, '<span class="no-break">$1</span>')
    .replace(/\n/g, "<br>");
}

export function renderRichText(value) {
  const source = String(value ?? "");
  let output = "";
  let cursor = 0;
  const pattern = /\[\[chem:([\s\S]*?)\]\]/g;
  for (const match of source.matchAll(pattern)) {
    output += renderPlainText(source.slice(cursor, match.index));
    output += `<span class="chem">${escapeHtml(match[1])}</span>`;
    cursor = match.index + match[0].length;
  }
  return output + renderPlainText(source.slice(cursor));
}

export function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function progressKey(packId, exerciseId) {
  return `${packId}::${exerciseId}`;
}

function issue(path, message) {
  return { path, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateExercisePayload(exercise, path, errors) {
  const payload = exercise.payload;
  if (!isPlainObject(payload)) {
    errors.push(issue(`${path}.payload`, "payload が必要です"));
    return;
  }
  const definition = getExerciseTypeDefinition(exercise.type);
  if (definition) definition.validate(payload, `${path}.payload`, (entryPath, message) => errors.push(issue(entryPath, message)));
}

export function validatePack(pack, { supportedTypes = SUPPORTED_EXERCISE_TYPES } = {}) {
  const errors = [];
  if (!isPlainObject(pack)) return { valid: false, errors: [issue("$", "教材JSONはobjectである必要があります")] };
  if (pack.schemaVersion !== SCHEMA_VERSION) errors.push(issue("schemaVersion", `対応versionは ${SCHEMA_VERSION} です`));
  if (pack.type !== PACK_TYPE) errors.push(issue("type", `type は ${PACK_TYPE} です`));
  if (!nonEmpty(pack.id)) errors.push(issue("id", "Pack IDが必要です"));
  if (!nonEmpty(pack.title)) errors.push(issue("title", "教材名が必要です"));
  if (!isPlainObject(pack.subject) || !nonEmpty(pack.subject.id) || !nonEmpty(pack.subject.name)) {
    errors.push(issue("subject", "subject.id と subject.name が必要です"));
  }
  if (!["active", "archived"].includes(pack.status)) errors.push(issue("status", "status は active または archived です"));
  if (!Array.isArray(pack.resources)) errors.push(issue("resources", "resources は配列です"));
  if (!Array.isArray(pack.exercises)) errors.push(issue("exercises", "exercises は配列です"));

  const resourceIds = new Set();
  (Array.isArray(pack.resources) ? pack.resources : []).forEach((resource, index) => {
    if (!isPlainObject(resource) || !nonEmpty(resource.id) || !nonEmpty(resource.kind)) {
      errors.push(issue(`resources[${index}]`, "resourceには id と kind が必要です"));
      return;
    }
    if (resourceIds.has(resource.id)) errors.push(issue(`resources[${index}].id`, "resource IDが重複しています"));
    resourceIds.add(resource.id);
  });

  const exerciseIds = new Set();
  const types = new Set(supportedTypes);
  (Array.isArray(pack.exercises) ? pack.exercises : []).forEach((exercise, index) => {
    const path = `exercises[${index}]`;
    if (!isPlainObject(exercise) || !nonEmpty(exercise.id) || !nonEmpty(exercise.type)) {
      errors.push(issue(path, "exerciseには id と type が必要です"));
      return;
    }
    if (exerciseIds.has(exercise.id)) errors.push(issue(`${path}.id`, "exercise IDが重複しています"));
    exerciseIds.add(exercise.id);
    if (!types.has(exercise.type)) errors.push(issue(`${path}.type`, `未対応の問題形式: ${exercise.type}`));
    if (exercise.resourceId && !resourceIds.has(exercise.resourceId)) {
      errors.push(issue(`${path}.resourceId`, `参照先resourceがありません: ${exercise.resourceId}`));
    }
    validateExercisePayload(exercise, path, errors);
  });
  return { valid: errors.length === 0, errors };
}

export function validateBackup(backup) {
  const errors = [];
  if (!isPlainObject(backup)) return { valid: false, errors: [issue("$", "バックアップはobjectである必要があります")] };
  if (backup.schemaVersion !== SCHEMA_VERSION) errors.push(issue("schemaVersion", `対応versionは ${SCHEMA_VERSION} です`));
  if (backup.type !== BACKUP_TYPE) errors.push(issue("type", `type は ${BACKUP_TYPE} です`));
  if (!Array.isArray(backup.packs)) errors.push(issue("packs", "packs は配列です"));
  if (!Array.isArray(backup.progress)) errors.push(issue("progress", "progress は配列です"));
  if (!Array.isArray(backup.history)) errors.push(issue("history", "history は配列です"));
  const packIds = new Set();
  const exerciseIdsByPack = new Map();
  (Array.isArray(backup.packs) ? backup.packs : []).forEach((pack, index) => {
    const validation = validatePack(pack);
    validation.errors.forEach(entry => errors.push(issue(`packs[${index}].${entry.path}`, entry.message)));
    if (!isPlainObject(pack) || !nonEmpty(pack.id)) return;
    if (packIds.has(pack.id)) errors.push(issue(`packs[${index}].id`, "Pack IDが重複しています"));
    packIds.add(pack.id);
    exerciseIdsByPack.set(pack.id, new Set(Array.isArray(pack.exercises) ? pack.exercises.filter(isPlainObject).map(exercise => exercise.id) : []));
  });
  const progressKeys = new Set();
  (Array.isArray(backup.progress) ? backup.progress : []).forEach((record, index) => {
    if (!isPlainObject(record) || !nonEmpty(record.key) || !nonEmpty(record.packId) || !nonEmpty(record.exerciseId)) {
      errors.push(issue(`progress[${index}]`, "key, packId, exerciseId が必要です"));
      return;
    }
    if (progressKeys.has(record.key)) errors.push(issue(`progress[${index}].key`, "progress keyが重複しています"));
    progressKeys.add(record.key);
    if (!packIds.has(record.packId)) errors.push(issue(`progress[${index}].packId`, "存在しないPackを参照しています"));
    if (record.key !== progressKey(record.packId, record.exerciseId)) errors.push(issue(`progress[${index}].key`, "key と packId/exerciseId が一致しません"));
    if (!exerciseIdsByPack.get(record.packId)?.has(record.exerciseId)) errors.push(issue(`progress[${index}].exerciseId`, "存在しない問題を参照しています"));
    for (const field of ["attempts", "correct", "wrong", "hesitant", "lapses", "streak", "strength", "stabilityDays", "recentMistakes", "averageResponseMs", "dueAt"]) {
      if (record[field] != null && (!Number.isFinite(record[field]) || record[field] < 0)) errors.push(issue(`progress[${index}].${field}`, "0以上の有限数値で指定します"));
    }
    for (const field of ["lastAttemptAt", "lastCorrectAt", "lastWrongAt", "lastCrossDaySuccessAt"]) {
      if (record[field] != null && (!Number.isFinite(record[field]) || record[field] < 0)) errors.push(issue(`progress[${index}].${field}`, "nullまたは有効なtimestampで指定します"));
    }
  });
  const historyIds = new Set();
  (Array.isArray(backup.history) ? backup.history : []).forEach((entry, index) => {
    const path = `history[${index}]`;
    if (!isPlainObject(entry) || !nonEmpty(entry.id) || !nonEmpty(entry.packId) || !nonEmpty(entry.exerciseId)) {
      errors.push(issue(path, "id, packId, exerciseId が必要です"));
      return;
    }
    if (historyIds.has(entry.id)) errors.push(issue(`${path}.id`, "history IDが重複しています"));
    historyIds.add(entry.id);
    if (!packIds.has(entry.packId)) errors.push(issue(`${path}.packId`, "存在しないPackを参照しています"));
    if (!exerciseIdsByPack.get(entry.packId)?.has(entry.exerciseId)) errors.push(issue(`${path}.exerciseId`, "存在しない問題を参照しています"));
    if (!Number.isFinite(entry.attemptedAt) || entry.attemptedAt < 0) errors.push(issue(`${path}.attemptedAt`, "有効なtimestampが必要です"));
    if (typeof entry.correct !== "boolean") errors.push(issue(`${path}.correct`, "correct は真偽値です"));
    if (!nonEmpty(entry.interactionType) || !getExerciseTypeDefinition(entry.interactionType)) errors.push(issue(`${path}.interactionType`, "対応済みの問題形式が必要です"));
  });
  return { valid: errors.length === 0, errors };
}

export function gradeExercise(exercise, response) {
  const definition = getExerciseTypeDefinition(exercise.type);
  if (!definition) throw new Error(`未対応の問題形式: ${exercise.type}`);
  return definition.grade(exercise.payload || {}, response);
}

export function emptyProgress(packId, exerciseId) {
  return {
    key: progressKey(packId, exerciseId),
    packId,
    exerciseId,
    attempts: 0,
    correct: 0,
    wrong: 0,
    hesitant: 0,
    lapses: 0,
    streak: 0,
    strength: 0,
    stabilityDays: 0.25,
    recentMistakes: 0,
    averageResponseMs: 0,
    lastOutcome: "unseen",
    lastAttemptAt: null,
    lastCorrectAt: null,
    lastWrongAt: null,
    lastCrossDaySuccessAt: null,
    dueAt: 0,
    evidence: {}
  };
}

export function updateMemory(previous, event, now = Date.now()) {
  if (!event || !nonEmpty(event.packId) || !nonEmpty(event.exerciseId)) throw new Error("packId と exerciseId が必要です");
  if (!getExerciseTypeDefinition(event.interactionType)) throw new Error(`未対応のinteractionType: ${event.interactionType}`);
  if (event.rating != null && !["again", "hard", "good", "easy"].includes(event.rating)) throw new Error(`不正なrating: ${event.rating}`);
  if (!Number.isFinite(now) || now < 0) throw new Error("now は有効なtimestampで指定します");
  if (event.responseMs != null && (!Number.isFinite(Number(event.responseMs)) || Number(event.responseMs) < 0)) throw new Error("responseMs は0以上の数値です");
  if (previous && (previous.packId !== event.packId || previous.exerciseId !== event.exerciseId || previous.key !== progressKey(event.packId, event.exerciseId))) {
    throw new Error("previous progress のidentityが回答対象と一致しません");
  }
  const record = { ...emptyProgress(event.packId, event.exerciseId), ...(previous || {}), key: progressKey(event.packId, event.exerciseId), packId: event.packId, exerciseId: event.exerciseId };
  const wasWrongToday = record.lastWrongAt && localDateKey(record.lastWrongAt) === localDateKey(now);
  const previousDay = record.lastCorrectAt ? localDateKey(record.lastCorrectAt) : null;
  const crossDay = Boolean(previousDay && previousDay !== localDateKey(now));
  const responseMs = Math.max(0, Number(event.responseMs) || 0);
  const result = event.rating || (event.correct ? "good" : "again");
  const correct = result !== "again" && event.correct !== false;
  const hesitant = result === "hard" || event.hesitant === true;
  const easy = result === "easy";
  const baseWeight = getExerciseTypeDefinition(event.interactionType).recallWeight;
  const hintPenalty = event.usedHint ? 0.22 : 0;
  const cramPenalty = event.sessionMode === "cram" ? 0.45 : 0;
  const slowPenalty = responseMs > 30_000 ? 0.08 : 0;
  const ratingWeight = easy ? 0.12 : hesitant ? -0.2 : 0;
  const quality = clamp(baseWeight - hintPenalty - cramPenalty - slowPenalty + ratingWeight, 0.1, 1);

  record.attempts += 1;
  record.lastAttemptAt = now;
  record.averageResponseMs = record.attempts === 1
    ? responseMs
    : Math.round(((record.averageResponseMs || 0) * (record.attempts - 1) + responseMs) / record.attempts);
  const previousEvidence = record.evidence?.[event.interactionType] || { attempts: 0, correct: 0, wrong: 0, hesitant: 0, lastAt: null };
  record.evidence = {
    ...(record.evidence || {}),
    [event.interactionType]: {
      ...previousEvidence,
      attempts: previousEvidence.attempts + 1,
      correct: previousEvidence.correct + (correct ? 1 : 0),
      wrong: previousEvidence.wrong + (correct ? 0 : 1),
      hesitant: previousEvidence.hesitant + (hesitant ? 1 : 0),
      lastAt: now
    }
  };

  if (!correct) {
    record.wrong += 1;
    record.lapses += 1;
    record.streak = 0;
    record.strength = clamp(record.strength * 0.45 - 0.05, 0, 1);
    record.stabilityDays = clamp(record.stabilityDays * 0.5, 0.12, 60);
    record.recentMistakes = Math.min(9, (record.recentMistakes || 0) + 1);
    record.lastOutcome = "wrong";
    record.lastWrongAt = now;
    record.dueAt = now + 10 * MINUTE;
    return record;
  }

  record.correct += 1;
  record.streak += 1;
  record.lastCorrectAt = now;
  if (hesitant) record.hesitant += 1;
  if (crossDay) record.lastCrossDaySuccessAt = now;

  let gain = (1 - record.strength) * (0.16 + quality * 0.34);
  if (wasWrongToday) gain *= 0.35;
  record.strength = clamp(record.strength + gain, 0, 0.99);
  const growth = 1 + quality * 0.5 + (crossDay ? 0.45 : 0) + (easy ? 0.15 : 0) - (hesitant ? 0.2 : 0);
  record.stabilityDays = clamp(record.stabilityDays * growth + (crossDay ? 0.35 : 0.08), 0.25, 60);
  if (wasWrongToday) record.stabilityDays = Math.min(record.stabilityDays, 1);
  record.recentMistakes = Math.max(0, record.recentMistakes - (crossDay ? 2 : wasWrongToday ? 0 : 1));
  record.lastOutcome = hesitant ? "hesitant" : "correct";

  let intervalDays = clamp(record.stabilityDays * (1 + record.strength * 2.6), 0.25, 60);
  if (hesitant) intervalDays = Math.min(intervalDays, 1);
  if (wasWrongToday) intervalDays = Math.min(intervalDays, 0.75);
  if (event.sessionMode === "cram") intervalDays = Math.min(intervalDays, 1);
  record.dueAt = now + Math.round(intervalDays * DAY);
  return record;
}

export function memoryFlags(record, now = Date.now()) {
  const item = record || {};
  const attempts = item.attempts || 0;
  const wrongRate = attempts ? (item.wrong || 0) / attempts : 0;
  return {
    unseen: attempts === 0,
    wrong: item.lastOutcome === "wrong" || (item.recentMistakes || 0) > 0,
    weak: attempts > 0 && ((item.strength || 0) < 0.45 || wrongRate >= 0.4),
    hesitant: item.lastOutcome === "hesitant" || (item.hesitant || 0) > Math.max(1, (item.correct || 0) / 2),
    due: attempts > 0 && Number(item.dueAt || 0) <= now,
    recentMistake: Boolean(item.lastWrongAt && now - item.lastWrongAt <= 3 * DAY),
    stale: attempts > 0 && Boolean(item.lastAttemptAt && now - item.lastAttemptAt >= 21 * DAY),
    slow: (item.averageResponseMs || 0) >= 30_000
  };
}

export function priorityScore(exercise, record, now = Date.now(), mode = "recommended") {
  const flags = memoryFlags(record, now);
  const importance = exercise.importance === "A" || exercise.importance === 3 ? 3
    : exercise.importance === "B" || exercise.importance === 2 ? 2 : 1;
  let score = importance * 6;
  if (flags.unseen) score += 88;
  if (flags.wrong) score += 105;
  if (flags.weak) score += 62;
  if (flags.hesitant) score += 48;
  if (flags.due) score += 68 + Math.min(30, Math.floor((now - Number(record?.dueAt || now)) / DAY) * 2);
  if (flags.recentMistake) score += 32;
  if (flags.stale) score += 24;
  if (mode === "cram") {
    score = importance * 18 + (flags.wrong ? 90 : 0) + (flags.hesitant ? 65 : 0) + (flags.slow ? 45 : 0) + (flags.weak ? 55 : 0);
    if (flags.unseen) score -= 30;
  }
  return score;
}

export function selectReviewQueue(exercises, progressByKey, {
  packId,
  limit = 20,
  mode = "recommended",
  now = Date.now(),
  random = Math.random
} = {}) {
  const candidates = exercises.map(exercise => {
    const record = progressByKey.get(progressKey(packId, exercise.id));
    return { exercise, record, flags: memoryFlags(record, now), score: priorityScore(exercise, record, now, mode) + random() * 4 };
  });
  if (mode === "weak") {
    return candidates.filter(item => item.flags.wrong || item.flags.weak || item.flags.hesitant || item.flags.due)
      .sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.exercise);
  }
  if (mode === "cram") {
    return candidates.filter(item => item.flags.wrong || item.flags.weak || item.flags.hesitant || item.flags.slow || item.exercise.importance === "A")
      .sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.exercise);
  }

  const urgent = candidates.filter(item => !item.flags.unseen && (item.flags.wrong || item.flags.due)).sort((a, b) => b.score - a.score);
  const urgentQuota = urgent.length ? Math.min(urgent.length, Math.max(1, Math.ceil(limit * 0.45))) : 0;
  const chosen = urgent.slice(0, urgentQuota);
  const chosenIds = new Set(chosen.map(item => item.exercise.id));
  const unseen = candidates.filter(item => item.flags.unseen && !chosenIds.has(item.exercise.id)).sort((a, b) => b.score - a.score);
  const remaining = candidates.filter(item => !chosenIds.has(item.exercise.id) && !item.flags.unseen).sort((a, b) => b.score - a.score);
  const slotsAfterUrgent = Math.max(0, limit - chosen.length);
  const unseenQuota = unseen.length && slotsAfterUrgent ? Math.max(1, Math.min(unseen.length, Math.floor(slotsAfterUrgent * 0.35))) : 0;
  chosen.push(...unseen.slice(0, unseenQuota), ...remaining.slice(0, slotsAfterUrgent - unseenQuota));
  if (chosen.length < limit) chosen.push(...unseen.slice(unseenQuota, unseenQuota + limit - chosen.length));
  return chosen.sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.exercise);
}

export function selectPackReviewQueue(pack, progressByKey, options = {}) {
  if (!pack || pack.status !== "active") return [];
  return selectReviewQueue(pack.exercises || [], progressByKey, { ...options, packId: pack.id });
}

export function scheduleWrongRetry(queue, exercise, random = Math.random) {
  const copy = queue.slice();
  if (copy.some(item => item.id === exercise.id && item.__wrongRetry)) return copy;
  const distinctBefore = new Set(copy.filter(item => item.id !== exercise.id).slice(0, 3).map(item => item.id));
  if (distinctBefore.size < 3) return copy;
  const offset = Math.min(copy.length, 3 + Math.floor(random() * Math.min(4, Math.max(1, copy.length - 2))));
  const retry = { ...exercise, __wrongRetry: true };
  copy.splice(offset, 0, retry);
  return copy;
}

export function summarizePack(pack, progressByKey, now = Date.now()) {
  const counts = { total: pack.exercises.length, seen: 0, mastered: 0, wrong: 0, weak: 0, hesitant: 0, due: 0 };
  let strength = 0;
  pack.exercises.forEach(exercise => {
    const record = progressByKey.get(progressKey(pack.id, exercise.id));
    const flags = memoryFlags(record, now);
    if (!flags.unseen) counts.seen += 1;
    if ((record?.strength || 0) >= 0.72 && !flags.wrong) counts.mastered += 1;
    if (flags.wrong) counts.wrong += 1;
    if (flags.weak) counts.weak += 1;
    if (flags.hesitant) counts.hesitant += 1;
    if (flags.due) counts.due += 1;
    strength += record?.strength || 0;
  });
  counts.mastery = counts.total ? Math.round(strength / counts.total * 100) : 0;
  return counts;
}

export function duplicatePack(pack, suffix = Date.now().toString(36)) {
  const clone = structuredClone(pack);
  const oldId = clone.id;
  clone.id = `${oldId}-copy-${suffix}`;
  clone.title = `${clone.title}（複製）`;
  clone.status = "active";
  clone.metadata = { ...(clone.metadata || {}), duplicatedFrom: oldId, userEdited: true };
  clone.createdAt = new Date().toISOString();
  clone.updatedAt = clone.createdAt;
  return clone;
}

export function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
