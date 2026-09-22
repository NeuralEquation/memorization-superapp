import { memoryFlags, progressKey, selectPackReviewQueue } from "./core.js?v=1.6.2";

export const GAME_MODES = Object.freeze({
  daily: { label: "今日のクエスト", code: "DAILY", limit: 5, description: "期限・ミス・未学習を優先" },
  adventure: { label: "冒険モード", code: "QUEST", limit: 10, description: "選んだ範囲を10問攻略" },
  review: { label: "復習ハント", code: "HUNT", limit: 10, description: "弱点と期限問題を追跡" },
  blitz: { label: "60秒ブリッツ", code: "BLITZ", limit: 30, seconds: 60, description: "60秒で何問解ける？" },
  boss: { label: "ボスバトル", code: "BOSS", limit: 20, seconds: 600, description: "80%以上でエリアを攻略" },
  endless: { label: "エンドレス", code: "∞", limit: 80, description: "未学習優先で終わりなく周回" },
  recognition: { label: "4択・意味つなぎ", code: "4択", limit: 10, description: "答えを選んで記憶の入口を作る" },
  strict: { label: "本番入力", code: "INPUT", limit: 10, description: "ヒントなしで完全想起" },
  puzzle: { label: "復元パズル", code: "PUZZLE", limit: 10, description: "語句タイルを正しい順に並べる" }
});

export const DEFAULT_GAME_STATE = Object.freeze({
  xp: 0,
  totalCorrect: 0,
  bestCombo: 0,
  dailyStreak: 0,
  lastActiveDate: "",
  bossClears: {}
});

const STAGE_LABELS = Object.freeze({
  "8-10": "8-10 国際経済",
  "11-12": "11-12 制度・環境",
  "3-3-1": "3編3章1",
  "4-2-6": "4編2章6"
});

export function normalizeGameState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    xp: Math.max(0, Number(source.xp) || 0),
    totalCorrect: Math.max(0, Number(source.totalCorrect) || 0),
    bestCombo: Math.max(0, Number(source.bestCombo) || 0),
    dailyStreak: Math.max(0, Number(source.dailyStreak) || 0),
    lastActiveDate: typeof source.lastActiveDate === "string" ? source.lastActiveDate : "",
    bossClears: source.bossClears && typeof source.bossClears === "object" && !Array.isArray(source.bossClears)
      ? structuredClone(source.bossClears) : {}
  };
}

export function dateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function updateDailyStreak(previousDate, currentStreak = 0, now = Date.now()) {
  const today = dateKey(now);
  if (!previousDate) return { date: today, streak: 1 };
  if (previousDate === today) return { date: today, streak: Math.max(1, currentStreak) };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { date: today, streak: previousDate === dateKey(yesterday.getTime()) ? currentStreak + 1 : 1 };
}

export function levelFromXp(xp = 0) {
  const safeXp = Math.max(0, Number(xp) || 0);
  const level = Math.floor(Math.sqrt(safeXp / 80)) + 1;
  const floor = Math.pow(level - 1, 2) * 80;
  const ceiling = Math.pow(level, 2) * 80;
  return {
    level,
    current: safeXp - floor,
    required: ceiling - floor,
    progress: Math.min(100, Math.round((safeXp - floor) / (ceiling - floor) * 100))
  };
}

export function rankName(level) {
  if (level >= 15) return "記憶の守護者";
  if (level >= 10) return "マスター";
  if (level >= 7) return "上級探究者";
  if (level >= 4) return "探究者";
  if (level >= 2) return "見習い研究員";
  return "はじめての挑戦者";
}

function difficultyOf(exercise) {
  if (Number.isFinite(exercise?.difficulty)) return Math.max(1, Math.min(3, exercise.difficulty));
  if (exercise?.importance === "A" || exercise?.importance === 3) return 3;
  if (exercise?.importance === "B" || exercise?.importance === 2) return 2;
  return 1;
}

export function calculateXp({ correct, combo = 0, exercise = null, responseMs = 0, mode = "daily" }) {
  if (!correct) return 1;
  const base = 10 + difficultyOf(exercise) * 3;
  const comboBonus = Math.min(20, Math.max(0, combo) * 2);
  const speedBonus = responseMs > 0 && responseMs <= 5000 ? 7 : responseMs <= 10000 ? 4 : 0;
  const modeBonus = mode === "boss" ? 6 : mode === "blitz" ? 4 : mode === "strict" ? 3 : mode === "puzzle" ? 2 : 0;
  return base + comboBonus + speedBonus + modeBonus;
}

export function bossDamage({ correct, combo = 0, exercise = null }) {
  return correct ? 10 + Math.min(15, combo * 2) + difficultyOf(exercise) * 2 : 0;
}

export function missionProgress(history = [], now = Date.now()) {
  const today = dateKey(now);
  const entries = history
    .filter(entry => dateKey(entry.attemptedAt || entry.studiedAt) === today)
    .sort((a, b) => (a.attemptedAt || a.studiedAt) - (b.attemptedAt || b.studiedAt));
  let combo = 0;
  let bestCombo = 0;
  for (const entry of entries) {
    combo = entry.correct ? combo + 1 : 0;
    bestCombo = Math.max(bestCombo, combo);
  }
  const correct = entries.filter(entry => entry.correct).length;
  return {
    answered: entries.length,
    correct,
    bestCombo,
    missions: [
      { id: "answer5", label: "5問に挑戦", current: entries.length, target: 5 },
      { id: "correct3", label: "3問正解", current: correct, target: 3 },
      { id: "combo3", label: "3コンボ", current: bestCombo, target: 3 }
    ]
  };
}

export function unlockedBadges(gameState, progress = []) {
  const game = normalizeGameState(gameState);
  const mastered = progress.filter(record => (record.attempts || 0) >= 2 && (record.strength || 0) >= .78 && (record.streak || 0) >= 2).length;
  const bossWins = Object.values(game.bossClears).reduce((sum, pack) => sum + Object.values(pack || {}).filter(clear => (clear.stars || 0) >= 2).length, 0);
  return [
    { id: "first", icon: "✦", name: "最初の一歩", unlocked: game.totalCorrect >= 1 },
    { id: "combo5", icon: "⚡", name: "5連鎖", unlocked: game.bestCombo >= 5 },
    { id: "xp500", icon: "◆", name: "500 XP", unlocked: game.xp >= 500 },
    { id: "master3", icon: "♛", name: "3項目マスター", unlocked: mastered >= 3 },
    { id: "boss1", icon: "🏆", name: "ボス撃破", unlocked: bossWins >= 1 },
    { id: "streak7", icon: "🔥", name: "7日連続", unlocked: game.dailyStreak >= 7 }
  ];
}

export function gameStateAfterAttempt(gameState, { correct, combo, xp, now = Date.now() }) {
  const game = normalizeGameState(gameState);
  const daily = updateDailyStreak(game.lastActiveDate, game.dailyStreak, now);
  return {
    ...game,
    xp: game.xp + Math.max(0, Number(xp) || 0),
    totalCorrect: game.totalCorrect + (correct ? 1 : 0),
    bestCombo: Math.max(game.bestCombo, Math.max(0, Number(combo) || 0)),
    dailyStreak: daily.streak,
    lastActiveDate: daily.date
  };
}

function stageExerciseIds(pack, predicate) {
  const resources = new Map((pack.resources || []).map(resource => [resource.id, resource]));
  return pack.exercises.filter(exercise => predicate(exercise, resources.get(exercise.resourceId))).map(exercise => exercise.id);
}

export function getPackStages(pack) {
  const constitutionStages = (pack.resources || []).filter(resource => resource.kind === "constitution-stage").sort((a, b) => a.order - b.order);
  if (constitutionStages.length) {
    return constitutionStages.map(stage => ({
      id: stage.id,
      key: stage.chapterId,
      name: stage.name,
      detail: (pack.resources || []).find(resource => resource.kind === "constitution-chapter" && resource.source?.legacyId === stage.chapterId)?.range || "",
      order: stage.order,
      clearRate: Number(stage.clearRate) || .8,
      star3Rate: Number(stage.star3Rate) || .9,
      bossQuestionCount: Number(stage.bossQuestionCount) || 20,
      exerciseIds: stageExerciseIds(pack, (exercise, resource) => {
        // Older user-edited built-ins are intentionally not overwritten during sync.
        const chapterId = resource?.chapterId || exercise.metadata?.chapterId
          || (pack.id === "constitution-quest" && exercise.id.startsWith("summary-cloze:") ? "overview" : "");
        return chapterId === stage.chapterId && exercise.type !== "full-recall";
      })
    }));
  }

  const resources = new Map((pack.resources || []).map(resource => [resource.id, resource]));
  const groups = new Map();
  for (const exercise of pack.exercises) {
    if (exercise.type === "full-recall") continue;
    const resource = resources.get(exercise.resourceId);
    const raw = exercise.metadata?.unit || exercise.metadata?.stage || resource?.stage || exercise.group || resource?.chapterId || "全範囲";
    if (!groups.has(raw)) groups.set(raw, []);
    groups.get(raw).push(exercise.id);
  }
  if (groups.size > 1) { groups.delete("all"); groups.delete("全範囲"); }
  return [...groups.entries()].map(([key, exerciseIds], index) => ({
    id: `area:${key}`,
    key,
    name: STAGE_LABELS[key] || key,
    detail: `${exerciseIds.length}問`,
    order: index + 1,
    clearRate: .8,
    star3Rate: .9,
    bossQuestionCount: Math.min(20, Math.max(10, exerciseIds.length)),
    exerciseIds
  }));
}

export function stageMastery(stage, packId, progressMap) {
  if (!stage.exerciseIds.length) return 0;
  const total = stage.exerciseIds.reduce((sum, exerciseId) => sum + (progressMap.get(progressKey(packId, exerciseId))?.strength || 0), 0);
  return Math.round(total / stage.exerciseIds.length * 100);
}

export function bossStars(rate, stage = {}) {
  const clearRate = Number(stage.clearRate) || .8;
  const star3Rate = Number(stage.star3Rate) || .9;
  return rate >= star3Rate ? 3 : rate >= clearRate ? 2 : rate >= .6 ? 1 : 0;
}

function shuffle(list, random = Math.random) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function buildPuzzleTiles(answer, random = Math.random) {
  const characters = Array.from(String(answer ?? ""));
  if (!characters.length) return [];
  const chunkSize = characters.length <= 4 ? 1 : characters.length <= 9 ? 2 : 3;
  const tiles = [];
  for (let index = 0; index < characters.length; index += chunkSize) {
    tiles.push({ id: `tile-${tiles.length}`, text: characters.slice(index, index + chunkSize).join("") });
  }
  const shuffled = shuffle(tiles, random);
  if (shuffled.length > 1 && shuffled.every((tile, index) => tile.id === tiles[index].id)) shuffled.push(shuffled.shift());
  return shuffled;
}

function fillQueue(pool, target, random) {
  if (!pool.length) return [];
  const queue = [];
  while (queue.length < target) queue.push(...shuffle(pool, random));
  return queue.slice(0, target).map((exercise, index, list) => {
    if (index && exercise.id === list[index - 1]?.id) {
      const swap = list.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.id !== exercise.id);
      if (swap > index) [list[index], list[swap]] = [list[swap], list[index]];
    }
    return list[index];
  });
}

export function selectGameQueue(pack, progressMap, { mode = "adventure", stageId = "", random = Math.random } = {}) {
  if (!pack || pack.status !== "active") return [];
  const stage = getPackStages(pack).find(item => item.id === stageId);
  const stageIds = stage ? new Set(stage.exerciseIds) : null;
  let exercises = pack.exercises.filter(exercise => exercise.type !== "full-recall" && (!stageIds || stageIds.has(exercise.id)));
  if (mode === "puzzle") exercises = exercises.filter(exercise => exercise.type === "cloze" || exercise.type === "text-input");
  if (!exercises.length) return [];
  const gamePack = { ...pack, exercises };
  if (mode === "review") {
    return selectPackReviewQueue(gamePack, progressMap, { limit: Math.min(GAME_MODES.review.limit, exercises.length), mode: "weak", random });
  }
  if (mode === "daily") {
    return selectPackReviewQueue(gamePack, progressMap, { limit: Math.min(GAME_MODES.daily.limit, exercises.length), mode: "recommended", random });
  }
  if (mode === "boss") {
    return shuffle(exercises, random).slice(0, Math.min(stage?.bossQuestionCount || GAME_MODES.boss.limit, exercises.length));
  }
  if (mode === "blitz") return fillQueue(exercises, GAME_MODES.blitz.limit, random);
  if (mode === "endless") {
    const unseen = exercises.filter(exercise => memoryFlags(progressMap.get(progressKey(pack.id, exercise.id))).unseen);
    const seen = exercises.filter(exercise => !unseen.includes(exercise));
    return [...shuffle(unseen, random), ...fillQueue(seen.length ? seen : exercises, Math.max(80, exercises.length), random)];
  }
  const limit = Math.min(GAME_MODES[mode]?.limit || 10, exercises.length);
  if (["adventure", "recognition", "strict", "puzzle"].includes(mode)) {
    return selectPackReviewQueue(gamePack, progressMap, { limit, mode: "recommended", random });
  }
  return shuffle(exercises, random).slice(0, limit);
}
