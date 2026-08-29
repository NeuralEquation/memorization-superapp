import { gradeExercise } from "./core.js?v=1.4.0";

export const CONSTITUTION_MOCK_COUNT = 30;
export const CONSTITUTION_MOCK_DURATION_MS = 15 * 60 * 1000;

function isMockCandidate(exercise) {
  return exercise?.type === "cloze" && (exercise.id?.startsWith("cloze:") || exercise.id?.startsWith("summary-cloze:"));
}

function isSummary(exercise) {
  return exercise.id.startsWith("summary-cloze:");
}

function articleNumber(resource) {
  return Number.isFinite(Number(resource?.articleNumber)) ? Number(resource.articleNumber) : 0;
}

function answerOf(exercise) {
  return exercise?.payload?.acceptedAnswers?.[0] || exercise?.payload?.answer || "";
}

function randomIndex(random, max) {
  const value = Number(random());
  const safe = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
  return Math.floor(safe * max);
}

function orderOf(exercise, resourceById) {
  if (isSummary(exercise)) return [0, 0, exercise.id];
  const resource = resourceById.get(exercise.resourceId);
  return [1, articleNumber(resource), resource?.id || exercise.resourceId || exercise.id];
}

function compareExercises(a, b, resourceById, segmentOrder = new Map()) {
  const left = orderOf(a, resourceById);
  const right = orderOf(b, resourceById);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return (segmentOrder.get(a.id) || 0) - (segmentOrder.get(b.id) || 0) || a.id.localeCompare(b.id);
}

export function getConstitutionMockCandidates(pack) {
  if (pack?.id !== "constitution-quest") return [];
  return (pack.exercises || []).filter(isMockCandidate);
}

export function selectConstitutionMockExercises(pack, { random = Math.random, count = CONSTITUTION_MOCK_COUNT } = {}) {
  const candidates = getConstitutionMockCandidates(pack);
  if (candidates.length < count) throw new Error(`模試問題が${count}問に足りません`);
  const shuffled = candidates.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  const resourceById = new Map((pack.resources || []).map(resource => [resource.id, resource]));
  const segmentOrder = new Map();
  resourceById.forEach(resource => (resource.segments || []).forEach((segment, index) => {
    if (segment.type === "blank") segmentOrder.set(`${resource.id}:${segment.blankId}`, index);
  }));
  return shuffled.slice(0, count).sort((a, b) => {
    const leftOrder = resourceById.get(a.resourceId);
    const rightOrder = resourceById.get(b.resourceId);
    const left = segmentOrder.get(`${a.resourceId}:${a.source?.legacyId}`) || 0;
    const right = segmentOrder.get(`${b.resourceId}:${b.source?.legacyId}`) || 0;
    return compareExercises(a, b, resourceById, new Map([[a.id, left], [b.id, right]]));
  });
}

export function buildConstitutionMockModel(pack, selectedExercises) {
  const selected = Array.isArray(selectedExercises) ? selectedExercises : [];
  const selectedIds = selected.map(exercise => typeof exercise === "string" ? exercise : exercise.id);
  const exerciseById = new Map((pack?.exercises || []).map(exercise => [exercise.id, exercise]));
  const chosen = selectedIds.map(id => exerciseById.get(id)).filter(Boolean);
  const selectedByResource = new Map();
  chosen.filter(exercise => !isSummary(exercise)).forEach(exercise => {
    const resourceId = exercise.resourceId;
    if (!selectedByResource.has(resourceId)) selectedByResource.set(resourceId, new Map());
    selectedByResource.get(resourceId).set(exercise.source?.legacyId, exercise.id);
  });
  const resources = new Map((pack?.resources || []).map(resource => [resource.id, resource]));
  const summaryItems = chosen.filter(isSummary).map(exercise => ({
    exerciseId: exercise.id,
    before: exercise.payload?.before || "",
    after: exercise.payload?.after || ""
  }));
  const groups = [];
  if (summaryItems.length) groups.push({ kind: "summary", label: "基本事項", items: summaryItems });
  const articleGroups = [...selectedByResource.entries()]
    .map(([resourceId, blankIds]) => ({ resource: resources.get(resourceId), blankIds }))
    .filter(item => item.resource)
    .sort((a, b) => articleNumber(a.resource) - articleNumber(b.resource));
  articleGroups.forEach(({ resource, blankIds }) => {
    const segments = (resource.segments || []).map(segment => {
      if (segment.type === "text") return { type: "text", text: segment.text || "" };
      const exerciseId = blankIds.get(segment.blankId);
      if (exerciseId) return { type: "input", exerciseId, blankId: segment.blankId };
      const exercise = exerciseById.get(`cloze:${segment.blankId}`);
      return { type: "text", text: answerOf(exercise) };
    });
    groups.push({
      kind: "article",
      label: resource.articleNumber ? `第${resource.articleNumber}条` : "前文",
      articleNumber: articleNumber(resource),
      resourceId: resource.id,
      segments
    });
  });
  return { packId: pack?.id, selectedExerciseIds: selectedIds, groups };
}

export function gradeConstitutionMock(pack, selectedExerciseIds, responses = {}) {
  const ids = Array.isArray(selectedExerciseIds) ? selectedExerciseIds : [];
  const exerciseById = new Map((pack?.exercises || []).map(exercise => [exercise.id, exercise]));
  const items = ids.map(exerciseId => {
    const exercise = exerciseById.get(exerciseId);
    const response = responses?.[exerciseId] ?? "";
    const unanswered = String(response).trim() === "";
    const grade = exercise ? gradeExercise(exercise, response) : { correct: false, expected: [] };
    return { exerciseId, response, correct: Boolean(grade.correct), unanswered, expected: grade.expected };
  });
  const correct = items.filter(item => item.correct).length;
  const unanswered = items.filter(item => item.unanswered).length;
  return {
    total: items.length,
    correct,
    incorrect: items.length - correct,
    unanswered,
    accuracy: items.length ? Math.round(correct / items.length * 100) : 0,
    items
  };
}

export function isConstitutionMockTimedOut(mockSession, now = Date.now()) {
  return Number(mockSession?.endsAt || 0) <= now;
}

export const createConstitutionMock = selectConstitutionMockExercises;
export const buildMockModel = buildConstitutionMockModel;
export const gradeMock = gradeConstitutionMock;
