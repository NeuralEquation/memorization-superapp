function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

function searchable(value, values = []) {
  if (value == null) return values;
  if (["string", "number", "boolean"].includes(typeof value)) values.push(String(value));
  else if (Array.isArray(value)) value.forEach(item => searchable(item, values));
  else if (typeof value === "object") Object.values(value).forEach(item => searchable(item, values));
  return values;
}

function resourceEntry(resource, linkedExercises = []) {
  return {
    id: resource.id,
    kind: "resource",
    item: resource,
    exerciseIds: linkedExercises.map(exercise => exercise.id),
    importance: resource.importance || linkedExercises[0]?.importance || "",
    group: resource.stage || resource.chapterId || resource.kind || "資料"
  };
}

function strongestImportance(exercises) {
  const rank = { A: 3, B: 2, C: 1 };
  return exercises.reduce((best, exercise) => (rank[exercise.importance] || 0) > (rank[best] || 0) ? exercise.importance : best, "");
}

function clozeGroupEntry(resource, exercises) {
  return {
    id: `cloze-group:${resource.id}`,
    kind: "cloze-group",
    item: resource,
    exercises,
    searchItems: exercises,
    exerciseIds: exercises.map(exercise => exercise.id),
    importance: strongestImportance(exercises),
    group: resource.chapterId || "条文"
  };
}

function exerciseEntry(exercise) {
  return {
    id: exercise.id,
    kind: "exercise",
    item: exercise,
    exerciseIds: [exercise.id],
    importance: exercise.importance || "",
    group: exercise.metadata?.unit || exercise.metadata?.topic || exercise.group || exercise.source?.sourceKind || exercise.type
  };
}

export function buildLibrarySections(pack) {
  const resources = pack.resources || [];
  const exercises = pack.exercises || [];
  const resourceById = new Map(resources.map(resource => [resource.id, resource]));
  const chapterNames = new Map(resources.filter(resource => resource.kind === "constitution-chapter")
    .map(chapter => [chapter.source?.legacyId || chapter.id.replace(/^chapter:/, ""), chapter.name]));
  const readableChapter = chapterId => chapterNames.get(chapterId) || chapterId;
  const links = new Map(resources.map(resource => [resource.id, []]));
  exercises.forEach(exercise => {
    if (exercise.resourceId && links.has(exercise.resourceId)) links.get(exercise.resourceId).push(exercise);
  });

  const concepts = resources.filter(resource => resource.kind === "concept");
  const articles = resources.filter(resource => resource.kind === "constitution-article");
  const supporting = resources.filter(resource => !["concept", "constitution-article", "constitution-chapter", "constitution-stage"].includes(resource.kind));
  const conceptIds = new Set(concepts.map(resource => resource.id));
  const articleIds = new Set(articles.map(resource => resource.id));
  const sections = [];

  if (concepts.length) {
    sections.push({ id: "concepts", label: "フラッシュカード", entries: concepts.map(resource => resourceEntry(resource, links.get(resource.id))) });
  }
  const judgements = concepts.length ? exercises.filter(exercise => exercise.type === "true-false") : [];
  if (judgements.length) sections.push({ id: "judgements", label: "正誤問題", entries: judgements.map(exerciseEntry) });

  if (articles.length) {
    sections.push({ id: "articles", label: "条文一覧", entries: articles.map(resource => ({ ...resourceEntry(resource, links.get(resource.id)), group: readableChapter(resource.chapterId) })) });
  }
  const cloze = exercises.filter(exercise => exercise.type === "cloze");
  const articleCloze = cloze.filter(exercise => articleIds.has(exercise.resourceId));
  const clozeByResource = new Map();
  articleCloze.forEach(exercise => {
    if (!clozeByResource.has(exercise.resourceId)) clozeByResource.set(exercise.resourceId, []);
    clozeByResource.get(exercise.resourceId).push(exercise);
  });
  const clozeGroups = articles.filter(resource => clozeByResource.has(resource.id))
    .map(resource => ({ ...clozeGroupEntry(resource, clozeByResource.get(resource.id)), group: readableChapter(resource.chapterId) }));
  if (clozeGroups.length) sections.push({ id: "cloze", label: "条文穴埋め", entries: clozeGroups, countLabel: `${clozeGroups.length}文・${articleCloze.length}穴`, resultUnit: `文（全${articleCloze.length}穴）` });
  const summaryCloze = cloze.filter(exercise => !articleIds.has(exercise.resourceId));
  if (summaryCloze.length) sections.push({ id: "summary-cloze", label: "基礎穴埋め", entries: summaryCloze.map(exerciseEntry), countLabel: `${summaryCloze.length}問`, resultUnit: "問" });
  const recall = exercises.filter(exercise => exercise.type === "full-recall");
  if (recall.length) sections.push({ id: "full-recall", label: "全文想起", entries: recall.map(exercise => {
    const entry = exerciseEntry(exercise);
    const resource = resourceById.get(exercise.resourceId);
    return resource?.chapterId ? { ...entry, group: readableChapter(resource.chapterId) } : entry;
  }) });

  const assignedExerciseIds = new Set([
    ...judgements.map(exercise => exercise.id),
    ...cloze.map(exercise => exercise.id),
    ...recall.map(exercise => exercise.id),
    ...exercises.filter(exercise => conceptIds.has(exercise.resourceId)).map(exercise => exercise.id),
    ...exercises.filter(exercise => articleIds.has(exercise.resourceId)).map(exercise => exercise.id)
  ]);
  const questions = exercises.filter(exercise => !assignedExerciseIds.has(exercise.id));
  if (questions.length) sections.push({ id: "questions", label: "問題一覧", entries: questions.map(exerciseEntry) });
  if (supporting.length) sections.push({ id: "resources", label: "資料一覧", entries: supporting.map(resource => resourceEntry(resource, links.get(resource.id) || [])) });
  return sections;
}

export function entrySearchText(entry) {
  return normalize(searchable([entry.item, entry.searchItems || []]).join(" "));
}

export function entryRecords(entry, packId, progressMap) {
  return entry.exerciseIds.map(exerciseId => progressMap.get(`${packId}::${exerciseId}`)).filter(Boolean);
}

export function entryStatus(entry, packId, progressMap, now = Date.now()) {
  const records = entryRecords(entry, packId, progressMap);
  if (!records.length || records.every(record => !(record.attempts > 0))) return "unseen";
  if (records.some(record => record.lastOutcome === "wrong" || (record.recentMistakes || 0) > 0)) return "wrong";
  if (records.some(record => (record.strength || 0) < 0.45 || Number(record.dueAt || Infinity) <= now)) return "weak";
  if (records.every(record => (record.strength || 0) >= 0.72)) return "mastered";
  return "learning";
}

export function filterLibraryEntries(section, filters, packId, progressMap, now = Date.now()) {
  const query = normalize(filters.query);
  return section.entries.filter(entry => {
    if (query && !entrySearchText(entry).includes(query)) return false;
    if (filters.importance && filters.importance !== "all" && String(entry.importance) !== filters.importance) return false;
    if (filters.group && filters.group !== "all" && entry.group !== filters.group) return false;
    if (filters.status && filters.status !== "all" && entryStatus(entry, packId, progressMap, now) !== filters.status) return false;
    return true;
  });
}

export function sectionGroups(section) {
  return [...new Set(section.entries.map(entry => entry.group).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
}
