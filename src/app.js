import {
  APP_VERSION,
  BACKUP_TYPE,
  PACK_TYPE,
  SCHEMA_VERSION,
  downloadJson,
  duplicatePack,
  escapeHtml,
  memoryFlags,
  progressKey,
  renderRichText,
  scheduleWrongRetry,
  selectPackReviewQueue,
  summarizePack,
  updateMemory,
  validateBackup,
  validatePack
} from "./core.js?v=1.6.1";
import { clozeContextParts, expectedAnswer, getHandler, renderFeedback } from "./exercise-registry.js?v=1.6.1";
import { buildLibrarySections, entryStatus, filterLibraryEntries, sectionGroups } from "./library.js?v=1.6.1";
import {
  CONSTITUTION_MOCK_DURATION_MS,
  buildConstitutionMockModel,
  gradeConstitutionMock,
  isConstitutionMockTimedOut,
  selectConstitutionMockExercises
} from "./constitution-mock.js?v=1.6.1";
import {
  GAME_MODES,
  bossDamage,
  bossStars,
  buildPuzzleTiles,
  calculateXp,
  gameStateAfterAttempt,
  getPackStages,
  levelFromXp,
  missionProgress,
  normalizeGameState,
  rankName,
  selectGameQueue,
  stageMastery,
  unlockedBadges
} from "./game.js?v=1.6.1";
import {
  createBackup,
  deletePackCompletely,
  loadAll,
  openStorage,
  putMeta,
  putPack,
  recordAttempt,
  replaceFromBackup,
  syncBuiltinPacks
} from "./storage.js?v=1.6.1";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal");

let db;
let snapshot = { meta: {}, packs: [], progress: [], history: [] };
let progressMap = new Map();
let currentView = "home";
let session = null;
let mockSession = null;
let mockTimer = null;
let pendingImport = null;
let pendingDeleteId = null;
let pendingBackup = null;
let toastTimer = null;
let gameTimer = null;
let libraryVisibleExerciseIds = [];
let libraryFilteredEntries = [];
let librarySearchComposing = false;
const openLibraryEntryIds = new Set();
const libraryState = { packId: "", sectionId: "", query: "", importance: "all", status: "all", group: "all", favorite: "all", limit: 60 };
const questState = { packId: "", stageId: "" };

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(Number(value) || 0);
}

function formatDate(timestamp) {
  if (!timestamp) return "未学習";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function refreshMaps() {
  progressMap = new Map(snapshot.progress.map(record => [record.key, record]));
}

function gameState() {
  return normalizeGameState(snapshot.meta?.game);
}

async function persistGameState(game) {
  snapshot.meta = { ...snapshot.meta, game: normalizeGameState(game) };
  await putMeta(db, snapshot.meta);
}

function clearGameTimer() {
  if (gameTimer) clearInterval(gameTimer);
  gameTimer = null;
}

function startGameTimer() {
  clearGameTimer();
  if (!session?.deadline || session.completed) return;
  gameTimer = setInterval(() => {
    if (!session?.deadline || session.completed) return clearGameTimer();
    session.secondsLeft = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
    const timer = document.querySelector("[data-game-timer]");
    if (timer) timer.textContent = session.mode === "blitz" ? `${session.secondsLeft}s` : `${String(Math.floor(session.secondsLeft / 60)).padStart(2, "0")}:${String(session.secondsLeft % 60).padStart(2, "0")}`;
    if (session.secondsLeft <= 0) {
      session.timedOut = true;
      session.completed = true;
      clearGameTimer();
      renderStudy();
    }
  }, 250);
}

function packById(packId) {
  return snapshot.packs.find(pack => pack.id === packId) || null;
}

function exerciseById(pack, exerciseId) {
  return pack?.exercises.find(exercise => exercise.id === exerciseId) || null;
}

function favoriteIdsFor(packId) {
  return new Set(snapshot.meta?.favorites?.[packId] || []);
}

function isFavorite(packId, itemId) {
  return favoriteIdsFor(packId).has(itemId);
}

async function toggleFavorite(packId, itemId) {
  const favorites = { ...(snapshot.meta?.favorites || {}) };
  const next = new Set(favorites[packId] || []);
  if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
  favorites[packId] = [...next];
  snapshot.meta = { ...snapshot.meta, favorites };
  await putMeta(db, snapshot.meta);
  renderLibrary(false, true);
  showToast(next.has(itemId) ? "お気に入りに追加しました" : "お気に入りから外しました");
}

function sourceLabel(exercise, pack = null) {
  const resource = pack?.resources?.find(item => item.id === exercise.resourceId);
  return resource?.title || exercise.metadata?.topic || exercise.payload?.heading || exercise.source?.legacyId || exercise.id;
}

function descriptionFor(pack) {
  if (pack.description) return pack.description;
  if (pack.id === "seikei-memorization") return "概念カード196枚と正誤232問を、検索・反復できます。";
  if (pack.id === "inorganic-chemistry") return "選択・短答・反応式を、化学表記のまま学習します。";
  if (pack.id === "constitution-quest") return "条文・穴埋め・全文想起を、章と出典を保って学習します。";
  return "JSONから追加した暗記教材です。";
}

function appShell(content, active = currentView) {
  const game = gameState();
  const player = levelFromXp(game.xp);
  return `<div class="app-shell">
    <header class="site-header">
      <div class="header-inner">
        <button class="brand" data-action="navigate" data-view="home" aria-label="教材一覧へ">
          <span class="brand-mark">F</span>
          <span class="brand-copy"><strong>暗記Foundry</strong><small>LOCAL MEMORY WORKSPACE</small></span>
        </button>
        <nav class="main-nav" aria-label="メインメニュー">
          <button class="nav-button ${active === "home" ? "active" : ""}" data-action="navigate" data-view="home">教材</button>
          <button class="nav-button ${active === "quests" ? "active" : ""}" data-action="navigate" data-view="quests">クエスト</button>
          <button class="nav-button ${active === "library" ? "active" : ""}" data-action="navigate" data-view="library">一覧</button>
          <button class="nav-button ${active === "progress" ? "active" : ""}" data-action="navigate" data-view="progress">学習記録</button>
          <button class="nav-button ${active === "manage" ? "active" : ""}" data-action="navigate" data-view="manage">管理</button>
        </nav>
        <div class="player-mini" aria-label="プレイヤー状況"><span>Lv.${player.level}</span><span>🔥 ${game.dailyStreak}日</span><strong>✦ ${formatNumber(game.xp)} XP</strong></div>
      </div>
    </header>
    ${content}
  </div>`;
}

function aggregateSummary(packs) {
  const total = { exercises: 0, seen: 0, mastered: 0, wrong: 0, due: 0 };
  packs.forEach(pack => {
    const summary = summarizePack(pack, progressMap);
    total.exercises += summary.total;
    total.seen += summary.seen;
    total.mastered += summary.mastered;
    total.wrong += summary.wrong;
    total.due += summary.due;
  });
  return total;
}

function packCard(pack) {
  const summary = summarizePack(pack, progressMap);
  const fullRecallCount = pack.exercises.filter(exercise => exercise.type === "full-recall").length;
  return `<article class="pack-card" data-pack-card="${escapeHtml(pack.id)}">
    <div class="pack-top"><span class="subject-chip">${escapeHtml(pack.subject.name)}</span><span class="type-chip">${formatNumber(pack.exercises.length)}問</span></div>
    <h3>${escapeHtml(pack.title)}</h3>
    <p>${escapeHtml(descriptionFor(pack))}</p>
    <div class="pack-progress">
      <div class="progress-label"><span>${formatNumber(summary.seen)}問を学習</span><strong>${summary.mastery}%</strong></div>
      <div class="progress-track" aria-label="習熟度${summary.mastery}%"><span style="width:${summary.mastery}%"></span></div>
      <div class="pack-flags"><span>未学習 ${summary.total - summary.seen}</span><span>弱点 ${summary.weak}</span><span>期限 ${summary.due}</span></div>
      <div class="pack-actions">
        <button class="primary" data-action="start" data-pack-id="${escapeHtml(pack.id)}" data-mode="recommended">おすすめ</button>
        <button class="secondary" data-action="start" data-pack-id="${escapeHtml(pack.id)}" data-mode="weak">弱点</button>
        <button class="ghost" data-action="start" data-pack-id="${escapeHtml(pack.id)}" data-mode="cram">直前</button>
        ${fullRecallCount ? `<button class="ghost" data-action="start" data-pack-id="${escapeHtml(pack.id)}" data-mode="full">全文想起</button>` : ""}
        ${pack.id === "constitution-quest" ? `<button class="secondary" data-action="start-constitution-mock" data-pack-id="${escapeHtml(pack.id)}">15分模試</button>` : ""}
        <button class="ghost wide" data-action="open-library" data-pack-id="${escapeHtml(pack.id)}">一覧・検索</button>
      </div>
    </div>
  </article>`;
}

function missionCard(mission, icon) {
  const percent = Math.min(100, Math.round(mission.current / mission.target * 100));
  return `<article class="mission-card ${percent >= 100 ? "done" : ""}"><span class="mission-icon">${percent >= 100 ? "✓" : icon}</span><div><strong>${escapeHtml(mission.label)}</strong><small>${Math.min(mission.current, mission.target)} / ${mission.target}</small><span class="mission-track"><i style="width:${percent}%"></i></span></div><b>+XP</b></article>`;
}

function gameModeCard(mode, packId, stageId = "") {
  const config = GAME_MODES[mode];
  return `<button class="game-mode-card ${mode}" data-action="start-game" data-pack-id="${escapeHtml(packId)}" data-mode="${mode}" ${stageId ? `data-stage-id="${escapeHtml(stageId)}"` : ""}><span>${config.code}</span><h3>${escapeHtml(config.label)}</h3><p>${escapeHtml(config.description)}</p><b>→</b></button>`;
}

function renderStageMap(pack) {
  const game = gameState();
  const stages = getPackStages(pack);
  const clears = game.bossClears?.[pack.id] || {};
  if (!stages.length) return `<div class="empty-state"><p>この教材にはエリア情報がありません。</p></div>`;
  return `<div class="stage-map">${stages.map(stage => {
    const mastery = stageMastery(stage, pack.id, progressMap);
    const clear = clears[stage.id];
    return `<article class="stage-card ${clear?.stars >= 2 ? "cleared" : mastery > 0 ? "active" : ""}">
      <div class="stage-head"><span>AREA ${String(stage.order).padStart(2, "0")}</span><b aria-label="ボス評価${clear?.stars || 0}">${clear ? "★".repeat(clear.stars) + "☆".repeat(3 - clear.stars) : "☆☆☆"}</b></div>
      <h3>${escapeHtml(stage.name)}</h3><p>${escapeHtml(stage.detail || `${stage.exerciseIds.length}問`)}</p>
      <div class="progress-track" aria-label="習熟度${mastery}%"><span style="width:${mastery}%"></span></div><small>${mastery}% 習熟 ・ ${stage.exerciseIds.length}問</small>
      <div class="stage-actions"><button class="ghost" data-action="start-game" data-pack-id="${escapeHtml(pack.id)}" data-mode="adventure" data-stage-id="${escapeHtml(stage.id)}">学習</button><button class="secondary" data-action="start-game" data-pack-id="${escapeHtml(pack.id)}" data-mode="boss" data-stage-id="${escapeHtml(stage.id)}">ボス</button></div>
    </article>`;
  }).join("")}</div>`;
}

function renderQuests() {
  const packs = snapshot.packs.filter(pack => pack.status === "active");
  if (!packs.length) { currentView = "home"; renderHome(); return; }
  if (!packs.some(pack => pack.id === questState.packId)) questState.packId = packs[0].id;
  const pack = packById(questState.packId);
  const stages = getPackStages(pack);
  const defaultStage = stages[0]?.id || "";
  const hasPuzzle = pack.exercises.some(exercise => ["cloze", "text-input"].includes(exercise.type));
  const content = `<main id="main-content" class="page">
    <div class="page-head"><div><p class="eyebrow">QUEST SELECT</p><h1>クエストを選ぶ</h1><p>元アプリのゲームモードを、同じ進捗とMemory Engineにつないで遊べます。</p></div><label class="quest-pack-select">教材<select data-quest-pack>${packs.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === pack.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></label></div>
    <section><div class="section-head"><div><h2>ゲームモード</h2><p>XP、コンボ、復習間隔はすべて共通記録へ保存されます。</p></div></div>
      <div class="game-mode-grid">${["daily", "adventure", "review", "blitz", "boss", "endless", "recognition", "strict"].map(mode => gameModeCard(mode, pack.id, mode === "boss" ? defaultStage : "")).join("")}${hasPuzzle ? gameModeCard("puzzle", pack.id) : ""}</div>
      ${pack.id === "constitution-quest" ? `<div class="special-mode-row"><button class="secondary" data-action="start-article-rebuild" data-pack-id="${escapeHtml(pack.id)}">条文連続復元</button><button class="secondary" data-action="start-constitution-mock" data-pack-id="${escapeHtml(pack.id)}">15分本番模試</button></div>` : ""}
    </section>
    <section><div class="section-head"><div><h2>エリアマップ</h2><p>範囲を学習し、ボス戦で80%以上を取るとエリアクリアです。</p></div></div>${renderStageMap(pack)}</section>
  </main>`;
  app.innerHTML = appShell(content, "quests");
}

function renderHome() {
  const packs = snapshot.packs.filter(pack => pack.status === "active");
  const summary = aggregateSummary(packs);
  const nextPack = packs.find(pack => summarizePack(pack, progressMap).due > 0) || packs[0];
  const game = gameState();
  const player = levelFromXp(game.xp);
  const missions = missionProgress(snapshot.history);
  const content = `<main id="main-content" class="page">
    <section class="game-hero">
      <div class="quest-hero"><p class="eyebrow">DAILY QUEST</p><h1>正解をつないで、<br>今日のエリアを進める。</h1><p>未学習・誤答・復習期限を優先しながらXPとコンボを獲得します。</p>${nextPack ? `<button class="primary" data-action="start-game" data-pack-id="${escapeHtml(nextPack.id)}" data-mode="daily">今日の5問に挑戦 <span>→</span></button>` : `<button class="primary" data-action="navigate" data-view="manage">教材を追加</button>`}<div class="hero-rewards"><span>✦ 正解でXP</span><span>⚡ 連続正解でコンボ</span><span>♜ ミスは後で再登場</span></div></div>
      <aside class="player-card"><div class="player-avatar">F<span>Lv.${player.level}</span></div><p class="eyebrow">PLAYER RANK</p><h2>${rankName(player.level)}</h2><p>次のレベルまで ${player.required - player.current} XP</p><div class="xp-track"><i style="width:${player.progress}%"></i></div><small>${player.current} / ${player.required} XP</small></aside>
    </section>
    <section class="game-stats"><div><strong>${formatNumber(game.xp)}</strong><span>総XP</span></div><div><strong>${game.dailyStreak}</strong><span>連続学習日</span></div><div><strong>${game.bestCombo}</strong><span>最高コンボ</span></div><div><strong>${summary.mastered}</strong><span>習得済み</span></div></section>
    <div class="section-head"><div><h2>今日のミッション</h2><p>短い目標を積み上げて学習を続けます。</p></div></div><section class="mission-grid">${missions.missions.map((mission, index) => missionCard(mission, ["◈", "✓", "⚡"][index])).join("")}</section>
    ${nextPack ? `<div class="section-head"><div><h2>ゲームモード</h2><p>${escapeHtml(nextPack.title)}ですぐ遊べます。</p></div><button class="ghost compact-action" data-action="navigate" data-view="quests">すべて見る →</button></div><section class="game-mode-grid home-modes">${gameModeCard("adventure", nextPack.id)}${gameModeCard("blitz", nextPack.id)}${gameModeCard("boss", nextPack.id, getPackStages(nextPack)[0]?.id || "")}</section>` : ""}
    <div class="section-head"><div><h2>教材</h2><p>すぐ始めるか、一覧で内容を確認できます。</p></div><button class="ghost compact-action" data-action="navigate" data-view="manage">管理</button></div>
    <section class="pack-grid" aria-label="Active教材一覧">
      ${packs.length ? packs.map(packCard).join("") : `<div class="empty-state"><h3>Active教材がありません</h3><p>Archiveから戻すか、教材JSONを追加してください。</p><button class="primary" data-action="navigate" data-view="manage">管理を開く</button></div>`}
    </section>
  </main>`;
  app.innerHTML = appShell(content, "home");
}

function statusLabel(status) {
  return { unseen: "未学習", wrong: "要復習", weak: "弱点", learning: "学習中", mastered: "定着" }[status] || status;
}

function entryMeta(entry, pack) {
  const status = entryStatus(entry, pack.id, progressMap);
  const importance = entry.importance ? `<span class="importance-chip importance-${escapeHtml(String(entry.importance).toLowerCase())}">重要度${escapeHtml(entry.importance)}</span>` : "";
  return `<div class="library-card-meta">${importance}<span class="status-chip status-${status}">${statusLabel(status)}</span><span class="type-chip">${escapeHtml(entry.group)}</span></div>`;
}

function exercisePrompt(exercise) {
  if (exercise.type === "true-false") return exercise.payload.statement;
  if (exercise.type === "cloze") return `${exercise.payload.before} ＿＿＿ ${exercise.payload.after}`;
  return exercise.payload.prompt || exercise.payload.heading || exercise.metadata?.topic || exercise.id;
}

function exerciseDetail(exercise) {
  const explanation = exercise.payload.explanation || exercise.metadata?.related || "";
  const caution = exercise.payload.caution || exercise.metadata?.caution || "";
  return `<div class="library-answer"><span>答え</span><strong>${renderRichText(expectedAnswer(exercise))}</strong></div>
    ${explanation ? `<p>${renderRichText(explanation)}</p>` : ""}
    ${caution ? `<p class="library-caution">注意: ${renderRichText(caution)}</p>` : ""}`;
}

function readableArticleText(value) {
  return String(value || "").replace(/。([2-9])(?=\S)/g, "。\n$1 ");
}

function clozeRevealButton(exercise, index) {
  const answer = exercise?.payload?.acceptedAnswers?.[0] || exercise?.payload?.answer || "答えなし";
  const dots = "●".repeat(Math.max(2, Math.min(6, [...String(answer)].length)));
  return `<button class="inline-cloze" type="button" data-action="reveal-library-blank" aria-expanded="false" aria-label="空欄${index + 1}の答えを表示"><span class="blank-mask">${dots}</span><span class="blank-answer">${renderRichText(answer)}</span></button>`;
}

function renderClozePassage(entry) {
  const resource = entry.item;
  const byLegacyId = new Map(entry.exercises.map(exercise => [exercise.source?.legacyId || exercise.id.replace(/^cloze:/, ""), exercise]));
  let blankIndex = 0;
  const passage = (resource.segments || []).map(segment => {
    if (segment.type === "text") return renderRichText(readableArticleText(segment.text));
    const exercise = byLegacyId.get(segment.blankId);
    return clozeRevealButton(exercise, blankIndex++);
  }).join("");
  return `<div class="cloze-instructions">空欄をタップすると、その場で答えが開きます。</div><p class="cloze-passage-text">${passage || renderRichText(resource.text)}</p>`;
}

function libraryDetailsAttributes(entry) {
  return `data-library-entry-id="${escapeHtml(entry.id)}"${openLibraryEntryIds.has(entry.id) ? " open" : ""}`;
}

function libraryEntryCard(entry, pack) {
  const item = entry.item;
  if (entry.kind === "resource" && item.kind === "concept") {
    return `<details class="library-card flash-card" ${libraryDetailsAttributes(entry)}>
      <summary>${entryMeta(entry, pack)}<button type="button" class="favorite-star ${isFavorite(pack.id, item.id) ? "is-favorite" : ""}" data-action="toggle-favorite" data-pack-id="${escapeHtml(pack.id)}" data-item-id="${escapeHtml(item.id)}" aria-pressed="${isFavorite(pack.id, item.id)}" aria-label="${isFavorite(pack.id, item.id) ? "お気に入りから外す" : "お気に入りに追加"}">${isFavorite(pack.id, item.id) ? "★" : "☆"}</button><h3>${escapeHtml(item.title)}</h3><p>${renderRichText(item.text)}</p><span class="reveal-note">開いて関連語・混同ポイントを確認</span></summary>
      <div class="library-card-body">
        ${item.pair ? `<div class="detail-line"><span>関連</span><strong>${escapeHtml(item.pair)}</strong></div>` : ""}
        ${item.trap ? `<div class="detail-line caution"><span>混同</span><strong>${escapeHtml(item.trap)}</strong></div>` : ""}
      </div>
    </details>`;
  }
  if (entry.kind === "resource" && item.kind === "constitution-article") {
    const articleLabel = item.articleNumber ? `第${item.articleNumber}条` : "前文";
    return `<details class="library-card article-card" ${libraryDetailsAttributes(entry)}>
      <summary>${entryMeta(entry, pack)}<span class="article-number">${articleLabel}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(String(item.text || "").slice(0, 90))}${String(item.text || "").length > 90 ? "…" : ""}</p><span class="reveal-note">条文全文を表示</span></summary>
      <div class="library-card-body article-text">${renderRichText(item.text)}</div>
    </details>`;
  }
  if (entry.kind === "cloze-group") {
    const articleLabel = item.articleNumber ? `第${item.articleNumber}条` : "前文";
    return `<details class="library-card cloze-article-card" ${libraryDetailsAttributes(entry)}>
      <summary>${entryMeta(entry, pack)}<span class="article-number">${articleLabel}</span><h3>${escapeHtml(item.title)}</h3><p>${entry.exerciseIds.length}か所を、1つの文章で確認します。</p><span class="reveal-note">文章を開く</span></summary>
      <div class="library-card-body">${renderClozePassage(entry)}
        <div class="cloze-card-actions">
          <button class="primary" data-action="start-library-entry" data-entry-id="${escapeHtml(entry.id)}">この条文を学習</button>
          <button class="secondary" data-action="start-library-from" data-entry-id="${escapeHtml(entry.id)}">ここから学習</button>
        </div>
      </div>
    </details>`;
  }
  if (entry.kind === "resource") {
    return `<details class="library-card" ${libraryDetailsAttributes(entry)}><summary>${entryMeta(entry, pack)}<h3>${escapeHtml(item.title || item.id)}</h3><p>${renderRichText(item.text || "")}</p><span class="reveal-note">詳しく表示</span></summary><div class="library-card-body">${renderRichText(item.text || "")}</div></details>`;
  }
  const handler = getHandler(item.type);
  const title = item.metadata?.topic || item.payload.heading || handler?.label || item.type;
  return `<details class="library-card question-list-card" ${libraryDetailsAttributes(entry)}>
    <summary>${entryMeta(entry, pack)}<h3>${escapeHtml(title)}</h3><p>${renderRichText(exercisePrompt(item))}</p><span class="reveal-note">答えと解説を表示</span></summary>
    <div class="library-card-body">${exerciseDetail(item)}</div>
  </details>`;
}

function selectOptions(values, selected, allLabel, labelFor = value => value) {
  return `<option value="all">${allLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(labelFor(value))}</option>`).join("")}`;
}

function ensureLibraryState(packId = libraryState.packId) {
  const active = snapshot.packs.filter(pack => pack.status === "active");
  const pack = active.find(item => item.id === packId) || active[0] || null;
  if (!pack) return { pack: null, sections: [], section: null };
  if (libraryState.packId !== pack.id) {
    libraryState.packId = pack.id;
    libraryState.sectionId = "";
    libraryState.query = "";
    libraryState.importance = "all";
    libraryState.status = "all";
    libraryState.group = "all";
    libraryState.favorite = "all";
    libraryState.limit = 60;
  }
  const sections = buildLibrarySections(pack);
  const section = sections.find(item => item.id === libraryState.sectionId) || sections[0] || null;
  libraryState.sectionId = section?.id || "";
  return { pack, sections, section };
}

function renderLibrary(restoreSearchFocus = false, preserveScroll = false) {
  const previousScrollY = preserveScroll ? window.scrollY : null;
  const active = snapshot.packs.filter(pack => pack.status === "active");
  const { pack, sections, section } = ensureLibraryState();
  if (!pack || !section) {
    app.innerHTML = appShell(`<main id="main-content" class="page"><div class="empty-state"><h3>一覧に表示できる教材がありません</h3><p>管理から教材を追加してください。</p></div></main>`, "library");
    return;
  }
  const groups = sectionGroups(section);
  if (libraryState.group !== "all" && !groups.includes(libraryState.group)) libraryState.group = "all";
  const filtered = filterLibraryEntries(section, { ...libraryState, favoriteIds: favoriteIdsFor(pack.id) }, pack.id, progressMap);
  const showAll = pack.id === "constitution-quest" && section.id === "cloze";
  const visible = showAll ? filtered : filtered.slice(0, libraryState.limit);
  libraryFilteredEntries = filtered;
  libraryVisibleExerciseIds = [...new Set(filtered.flatMap(entry => entry.exerciseIds))];
  const resultDescription = section.id === "cloze" ? `文・${formatNumber(libraryVisibleExerciseIds.length)}穴` : `${section.resultUnit || "件"}（${section.label}）`;
  const content = `<main id="main-content" class="page library-page">
    <div class="page-head library-head"><div><p class="eyebrow">BROWSE. FIND. REVIEW.</p><h1>教材ライブラリ</h1><p>カード・問題・条文を検索できます。重要度や学習状況で絞れます。選んだ範囲だけを学習できます。</p></div>
      <label class="pack-select"><span>教材</span><select data-library-filter="packId">${active.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === pack.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></label></div>
    <div class="library-tabs" role="tablist" aria-label="一覧の種類">${sections.map(item => `<button role="tab" aria-selected="${item.id === section.id}" class="${item.id === section.id ? "active" : ""}" data-action="library-section" data-section-id="${escapeHtml(item.id)}">${escapeHtml(item.label)} <span>${escapeHtml(item.countLabel || formatNumber(item.entries.length))}</span></button>`).join("")}</div>
    <section class="library-toolbar" aria-label="一覧の絞り込み">
      <label class="library-search"><span>検索</span><input type="search" data-library-search value="${escapeHtml(libraryState.query)}" placeholder="用語・問題文・解説を検索" autocomplete="off"></label>
      <label><span>重要度</span><select data-library-filter="importance">${selectOptions(["A", "B", "C"], libraryState.importance, "すべて")}</select></label>
      <label><span>学習状況</span><select data-library-filter="status">${selectOptions(["unseen", "wrong", "weak", "learning", "mastered"], libraryState.status, "すべて", statusLabel)}</select></label>
      ${section.id === "concepts" ? `<label class="library-favorite-filter"><span>お気に入り</span><select data-library-filter="favorite"><option value="all" ${libraryState.favorite === "all" ? "selected" : ""}>すべて</option><option value="favorites" ${libraryState.favorite === "favorites" ? "selected" : ""}>お気に入りのみ</option></select></label>` : ""}
      <label class="library-group-filter"><span>範囲</span><select data-library-filter="group">${selectOptions(groups, libraryState.group, "すべて")}</select></label>
      <button class="ghost reset-filter" data-action="reset-library">条件をリセット</button>
    </section>
    <div class="library-result-head"><div><strong>${formatNumber(filtered.length)}</strong><span>${escapeHtml(resultDescription)}</span></div><div class="library-result-actions">${showAll ? `<button class="ghost" data-action="library-open-all">すべて開く</button><button class="ghost" data-action="library-close-all">すべて閉じる</button>` : ""}<button class="primary" data-action="start-library" ${libraryVisibleExerciseIds.length ? "" : "disabled"}>表示中から学習</button></div></div>
    <section class="library-grid" aria-label="${escapeHtml(section.label)}">${visible.length ? visible.map(entry => libraryEntryCard(entry, pack)).join("") : `<div class="empty-state"><h3>該当する項目がありません</h3><p>検索語や絞り込み条件を変えてください。</p><button class="ghost" data-action="reset-library">条件をリセット</button></div>`}</section>
    ${!showAll && visible.length < filtered.length ? `<div class="load-more"><button class="ghost" data-action="library-more">さらに表示（残り${formatNumber(filtered.length - visible.length)}件）</button></div>` : ""}
  </main>`;
  app.innerHTML = appShell(content, "library");
  if (restoreSearchFocus || preserveScroll) requestAnimationFrame(() => {
    if (previousScrollY !== null) window.scrollTo(0, previousScrollY);
    const input = document.querySelector("[data-library-search]");
    if (restoreSearchFocus) {
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

function getStudyPool(pack, mode) {
  if (mode === "full") return pack.exercises.filter(exercise => exercise.type === "full-recall");
  return pack.exercises.filter(exercise => exercise.type !== "full-recall");
}

function beginSession(packId, mode, queue, sourceExerciseIds = null) {
  clearGameTimer();
  session = {
    packId,
    mode,
    queue,
    targetCount: queue.length,
    sourceExerciseIds,
    index: 0,
    correct: 0,
    wrong: 0,
    startedAt: Date.now(),
    questionStartedAt: Date.now(),
    result: null,
    presentation: null,
    presentationKey: null,
    usedHint: false,
    hint: "",
    retryCounts: {},
    combo: 0,
    bestCombo: 0,
    xpEarned: 0,
    answered: 0,
    playerHp: 100,
    bossHp: 100,
    secondsLeft: GAME_MODES[mode]?.seconds || 0,
    stageId: "",
    stageName: "",
    puzzleTiles: [],
    puzzleSelected: [],
    completed: false
  };
  currentView = "study";
  render();
}

function startGameSession(packId, mode, stageId = "") {
  const pack = packById(packId);
  if (!pack || pack.status !== "active") return showToast("この教材ではクエストを開始できません");
  let selectedStageId = stageId;
  if (mode === "boss" && !selectedStageId) selectedStageId = getPackStages(pack)[0]?.id || "";
  const queue = selectGameQueue(pack, progressMap, { mode, stageId: selectedStageId });
  if (!queue.length) return showToast(mode === "review" ? "対象の弱点がないため、まず通常学習を進めてください" : "この条件に合う問題がありません");
  beginSession(packId, mode, queue);
  const stage = getPackStages(pack).find(item => item.id === selectedStageId);
  session.stageId = selectedStageId;
  session.stageName = stage?.name || "全範囲";
  session.deadline = GAME_MODES[mode]?.seconds ? Date.now() + GAME_MODES[mode].seconds * 1000 : null;
  renderStudy();
  if (session.deadline) startGameTimer();
}

function articleRebuildCandidates(pack) {
  return (pack.resources || []).filter(resource => resource.kind === "constitution-article" && (resource.segments || []).filter(segment => segment.type === "blank").length >= 2);
}

function startArticleRebuild(packId) {
  const pack = packById(packId);
  const candidates = articleRebuildCandidates(pack);
  if (!candidates.length) return showToast("複数空欄のある条文がありません");
  const article = candidates[Math.floor(Math.random() * candidates.length)];
  const exerciseIds = article.segments.filter(segment => segment.type === "blank").map(segment => `cloze:${segment.blankId}`).filter(id => exerciseById(pack, id));
  clearGameTimer();
  session = {
    packId, mode: "article", article, articleExerciseIds: exerciseIds, articleValues: {}, articleResult: null,
    startedAt: Date.now(), questionStartedAt: Date.now(), correct: 0, wrong: 0, answered: 0, combo: 0,
    bestCombo: 0, xpEarned: 0, retryCounts: {}, completed: false
  };
  currentView = "study";
  renderStudy();
}

function startSession(packId, mode) {
  const pack = packById(packId);
  if (!pack || pack.status !== "active") {
    showToast("Archive中の教材は通常学習を開始できません");
    return;
  }
  const pool = getStudyPool(pack, mode);
  const limit = mode === "full" ? Math.min(5, pool.length) : Math.min(20, pool.length);
  const studyPack = { ...pack, exercises: pool };
  let queue = selectPackReviewQueue(studyPack, progressMap, { limit, mode: mode === "full" ? "recommended" : mode });
  if (!queue.length && mode !== "recommended") {
    queue = selectPackReviewQueue(studyPack, progressMap, { limit, mode: "recommended" });
    showToast("対象の弱点がないため、おすすめ問題を出題します");
  }
  if (!queue.length) {
    showToast("この教材には出題できる問題がありません");
    return;
  }
  beginSession(packId, mode, queue);
}

function startLibrarySession(packId, exerciseIds = libraryVisibleExerciseIds) {
  const pack = packById(packId);
  if (!pack || pack.status !== "active") return;
  const selectedIds = new Set(exerciseIds);
  const pool = pack.exercises.filter(exercise => selectedIds.has(exercise.id));
  if (!pool.length) {
    showToast("この一覧には出題できる問題がありません");
    return;
  }
  const queue = selectPackReviewQueue({ ...pack, exercises: pool }, progressMap, { limit: Math.min(20, pool.length), mode: "recommended" });
  beginSession(packId, "library", queue, pool.map(exercise => exercise.id));
}

function startOrderedLibrarySession(packId, exerciseIds) {
  const pack = packById(packId);
  if (!pack || pack.status !== "active") return;
  const exercises = new Map(pack.exercises.map(exercise => [exercise.id, exercise]));
  const orderedPool = [...new Set(exerciseIds)].map(id => exercises.get(id)).filter(Boolean);
  if (!orderedPool.length) {
    showToast("この範囲には出題できる問題がありません");
    return;
  }
  beginSession(packId, "library", orderedPool.slice(0, 20), orderedPool.map(exercise => exercise.id));
}

const MOCK_STORAGE_KEY = "memory-foundry-constitution-mock";

function clearMockTimer() {
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = null;
}

function clearMockStorage() {
  try { sessionStorage.removeItem(MOCK_STORAGE_KEY); } catch { /* private browsing can deny storage */ }
}

function persistMockSession() {
  if (!mockSession || mockSession.completed) return;
  try {
    sessionStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify({
      packId: mockSession.packId,
      selectedExerciseIds: mockSession.selectedExerciseIds,
      responses: mockSession.responses,
      startedAt: mockSession.startedAt,
      endsAt: mockSession.endsAt
    }));
  } catch { /* sessionStorage is an enhancement; the active page remains usable */ }
}

function restoreMockSession() {
  try {
    const raw = sessionStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.packId !== "constitution-quest" || !Array.isArray(saved.selectedExerciseIds) || !saved.selectedExerciseIds.length) return null;
    if (!Number.isFinite(saved.startedAt) || !Number.isFinite(saved.endsAt)) return null;
    return {
      packId: saved.packId,
      selectedExerciseIds: saved.selectedExerciseIds,
      responses: saved.responses && typeof saved.responses === "object" ? saved.responses : {},
      startedAt: saved.startedAt,
      endsAt: saved.endsAt,
      submittedAt: null,
      completed: false,
      timedOut: false,
      result: null,
      submitting: false
    };
  } catch {
    clearMockStorage();
    return null;
  }
}

function startConstitutionMock(packId) {
  const pack = packById(packId);
  if (!pack || pack.id !== "constitution-quest" || pack.status !== "active") return;
  clearMockTimer();
  clearMockStorage();
  const selected = selectConstitutionMockExercises(pack);
  const startedAt = Date.now();
  mockSession = {
    packId,
    selectedExerciseIds: selected.map(exercise => exercise.id),
    responses: {},
    startedAt,
    endsAt: startedAt + CONSTITUTION_MOCK_DURATION_MS,
    submittedAt: null,
    completed: false,
    timedOut: false,
    result: null,
    submitting: false
  };
  persistMockSession();
  currentView = "mock";
  render();
  startMockTimer();
}

function formatMockTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function mockExercise(pack, exerciseId) {
  return exerciseById(pack, exerciseId);
}

function mockArticleSegment(segment, pack) {
  if (segment.type === "text") return renderRichText(segment.text);
  const current = mockSession.responses[segment.exerciseId] ?? "";
  return `<input class="mock-blank-input" data-mock-input="${escapeHtml(segment.exerciseId)}" value="${escapeHtml(current)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="空欄の回答">`;
}

function renderMockResult(pack) {
  const result = mockSession.result || { correct: 0, total: mockSession.selectedExerciseIds.length, incorrect: mockSession.selectedExerciseIds.length, unanswered: 0, accuracy: 0, items: [] };
  const elapsed = Math.max(0, (mockSession.submittedAt || Date.now()) - mockSession.startedAt);
  const wrongItems = result.items.filter(item => !item.correct);
  const wrongList = wrongItems.length ? `<section class="mock-wrong-list"><h2>間違えた問題</h2>${wrongItems.map(item => {
    const exercise = mockExercise(pack, item.exerciseId);
    const resource = pack.resources?.find(candidate => candidate.id === exercise?.resourceId);
    const label = exercise?.id.startsWith("summary-cloze:") ? "基本事項" : resource?.articleNumber ? `第${resource.articleNumber}条` : "前文";
    const contextParts = exercise ? clozeContextParts(exercise.payload, 90) : { before: "", after: "" };
    const context = exercise ? `${contextParts.before}［${item.response || "未回答"}］${contextParts.after}` : "";
    return `<article class="mock-wrong-item"><strong>${escapeHtml(label)}</strong><p>${renderRichText(context)}</p><small>正答: ${renderRichText((item.expected || []).join(" / "))}</small></article>`;
  }).join("")}</section>` : `<p class="mock-all-correct">全問正解です。</p>`;
  return appShell(`<main id="main-content" class="study-page"><div class="study-wrap"><section class="study-result mock-result">
    <p class="eyebrow">15-MINUTE MOCK COMPLETE</p><h1>${result.correct} / ${result.total}</h1><p class="mock-score">${result.accuracy}%</p>
    <div class="summary-grid"><div class="summary-card"><strong>+${mockSession.xpEarned || 0}</strong><span>獲得XP</span></div><div class="summary-card"><strong>${result.incorrect}</strong><span>不正解</span></div><div class="summary-card"><strong>${result.unanswered}</strong><span>未回答</span></div><div class="summary-card"><strong>${formatMockTime(elapsed)}</strong><span>所要時間</span></div></div>
    ${mockSession.timedOut ? `<p class="hint-box">時間切れで自動提出しました。</p>` : ""}${wrongList}
    <div class="button-row" style="justify-content:center"><button class="primary" data-action="restart-constitution-mock">別の30問</button>${wrongItems.length ? `<button class="secondary" data-action="mock-review-wrong">間違えた問題だけ復習</button>` : ""}<button class="ghost" data-action="quit-mock">教材一覧へ</button></div>
  </section></div></main>`, "study");
}

function renderMock() {
  const pack = packById(mockSession?.packId);
  if (!pack || pack.id !== "constitution-quest" || pack.status !== "active") {
    clearMockTimer(); clearMockStorage(); mockSession = null; currentView = "home"; renderHome(); return;
  }
  if (mockSession.completed) {
    app.innerHTML = renderMockResult(pack);
    return;
  }
  const selected = mockSession.selectedExerciseIds.map(id => mockExercise(pack, id)).filter(Boolean);
  const model = buildConstitutionMockModel(pack, selected);
  const remaining = Math.max(0, mockSession.endsAt - Date.now());
  const groups = model.groups.map(group => {
    if (group.kind === "summary") {
      return `<section class="mock-section mock-summary-section"><h2>${escapeHtml(group.label)}</h2>${group.items.map(item => `<p class="mock-summary-line">${renderRichText(item.before)}${mockArticleSegment({ type: "input", exerciseId: item.exerciseId }, pack)}${renderRichText(item.after)}</p>`).join("")}</section>`;
    }
    return `<section class="mock-section"><h2>${escapeHtml(group.label)}</h2><p class="mock-article-text">${group.segments.map(segment => mockArticleSegment(segment, pack)).join("")}</p></section>`;
  }).join("");
  app.innerHTML = appShell(`<main id="main-content" class="study-page mock-page"><div class="study-wrap">
    <div class="mock-hud"><div><p class="eyebrow">CONSTITUTION QUEST</p><strong>15分模試</strong><span>30か所・記述式</span></div><div class="mock-timer" data-mock-timer aria-live="polite">${formatMockTime(remaining)}</div></div>
    <p class="mock-note">条文見出しは省略しています。文中の空欄だけに入力してください。</p>${groups}
    <div class="mock-submit-row"><button class="primary" data-action="submit-constitution-mock">提出する</button><button class="ghost" data-action="quit-mock">中断</button></div>
  </div></main>`, "study");
}

function startMockTimer() {
  clearMockTimer();
  if (!mockSession || mockSession.completed) return;
  const tick = () => {
    if (!mockSession || mockSession.completed) return clearMockTimer();
    const remaining = Math.max(0, mockSession.endsAt - Date.now());
    document.querySelector("[data-mock-timer]")?.replaceChildren(document.createTextNode(formatMockTime(remaining)));
    if (isConstitutionMockTimedOut(mockSession)) submitConstitutionMock(true);
  };
  tick();
  mockTimer = setInterval(tick, 1000);
}

async function submitConstitutionMock(timedOut = false) {
  if (!mockSession || mockSession.completed || mockSession.submitting) return;
  const activeMock = mockSession;
  activeMock.submitting = true;
  clearMockTimer();
  const pack = packById(activeMock.packId);
  const result = gradeConstitutionMock(pack, activeMock.selectedExerciseIds, activeMock.responses);
  const now = Date.now();
  let nextGame = gameState();
  let combo = 0;
  let xpEarned = 0;
  try {
    for (let index = 0; index < result.items.length; index += 1) {
      const item = result.items[index];
      combo = item.correct ? combo + 1 : 0;
      const xp = item.correct ? 5 : 0;
      xpEarned += xp;
      nextGame = gameStateAfterAttempt(nextGame, { correct: item.correct, combo, xp, now });
      const previous = progressMap.get(progressKey(pack.id, item.exerciseId));
      const progress = updateMemory(previous, {
        packId: pack.id,
        exerciseId: item.exerciseId,
        interactionType: "cloze",
        correct: item.correct,
        rating: item.correct ? "good" : "again",
        usedHint: false,
        sessionMode: "mock"
      }, now + index);
      const history = {
        id: randomId("attempt"), packId: pack.id, exerciseId: item.exerciseId,
        interactionType: "cloze", originalType: "cloze", correct: item.correct,
        rating: item.correct ? "good" : "again", usedHint: false, sessionMode: "mock", attemptedAt: now + index, xp, combo
      };
      const nextMeta = index === result.items.length - 1 ? { ...snapshot.meta, game: nextGame } : null;
      await recordAttempt(db, progress, history, nextMeta);
      const existingIndex = snapshot.progress.findIndex(record => record.key === progress.key);
      if (existingIndex >= 0) snapshot.progress[existingIndex] = progress; else snapshot.progress.push(progress);
      snapshot.history.unshift(history);
      progressMap.set(progress.key, progress);
    }
    snapshot.meta = { ...snapshot.meta, game: nextGame };
  } catch (error) {
    activeMock.submitting = false;
    showToast(`模試結果を保存できませんでした: ${error.message}`);
    startMockTimer();
    return;
  }
  activeMock.submitting = false;
  activeMock.completed = true;
  activeMock.timedOut = timedOut;
  activeMock.submittedAt = now;
  activeMock.result = result;
  activeMock.xpEarned = xpEarned;
  clearMockStorage();
  mockSession = activeMock;
  renderMock();
}

function handleMockInput(event) {
  const input = event.target.closest("[data-mock-input]");
  if (!input || !mockSession || mockSession.completed) return;
  mockSession.responses[input.dataset.mockInput] = input.value;
  persistMockSession();
}

function firstAcceptedAnswer(exercise) {
  const payload = exercise.payload || {};
  if (exercise.type === "cloze") return payload.acceptedAnswers?.[0] || payload.answer;
  if (exercise.type === "text-input") return payload.acceptedAnswers?.[0];
  return null;
}

function promptForRecognition(exercise) {
  if (exercise.type === "cloze") return `${exercise.payload.before} ＿＿＿ ${exercise.payload.after}`;
  return exercise.payload.prompt;
}

function shuffle(list) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function recognitionVersion(pack, exercise) {
  const answer = firstAcceptedAnswer(exercise);
  if (!answer) return exercise;
  const distractors = shuffle(pack.exercises
    .filter(candidate => candidate.id !== exercise.id && ["text-input", "cloze"].includes(candidate.type))
    .map(firstAcceptedAnswer)
    .filter(Boolean)
    .filter((value, index, values) => value !== answer && values.indexOf(value) === index)).slice(0, 3);
  if (distractors.length < 3) return exercise;
  const options = shuffle([answer, ...distractors]).map((text, index) => ({ id: `option-${index}`, text }));
  const correct = options.find(option => option.text === answer);
  return {
    ...exercise,
    type: "single-choice",
    payload: {
      prompt: promptForRecognition(exercise),
      options,
      correctOptionId: correct.id,
      explanation: exercise.payload.explanation,
      caution: exercise.payload.caution,
      pair: exercise.payload.pair
    },
    __originalType: exercise.type,
    __recognition: true
  };
}

function currentBaseExercise() {
  return session?.queue[session.index] || null;
}

function currentPresentation() {
  const base = currentBaseExercise();
  if (!base) return null;
  const key = `${session.index}:${base.id}`;
  if (session.presentationKey === key && session.presentation) return session.presentation;
  const pack = packById(session.packId);
  const record = progressMap.get(progressKey(pack.id, base.id));
  session.presentation = session.mode === "recognition" || (session.mode === "recommended" && !(record?.attempts)) ? recognitionVersion(pack, base) : base;
  session.presentationKey = key;
  return session.presentation;
}

function ensurePuzzle(presentation) {
  const key = `${session.index}:${presentation.id}`;
  if (session.puzzleKey === key) return;
  const answer = firstAcceptedAnswer(presentation);
  session.puzzleKey = key;
  session.puzzleTiles = buildPuzzleTiles(answer);
  session.puzzleSelected = [];
}

function renderPuzzleAnswer(presentation) {
  ensurePuzzle(presentation);
  const selected = session.puzzleSelected || [];
  const assembled = selected.map(id => session.puzzleTiles.find(tile => tile.id === id)?.text || "").join("");
  const available = session.puzzleTiles.filter(tile => !selected.includes(tile.id));
  return `<div class="puzzle-board"><div class="puzzle-answer">${assembled ? escapeHtml(assembled) : "<span>下のタイルを順番に選択</span>"}</div><div class="puzzle-tiles">${available.map(tile => `<button data-action="puzzle-add" data-tile-id="${tile.id}">${escapeHtml(tile.text)}</button>`).join("")}</div>${selected.length ? `<button class="text-button" data-action="puzzle-undo">1つ戻す</button>` : ""}</div>`;
}

function studyModeLabel(mode) {
  return {
    recommended: "おすすめ学習", weak: "弱点復習", cram: "試験直前", full: "全文想起", library: "一覧から学習",
    daily: "今日のクエスト", adventure: "冒険モード", review: "復習ハント", blitz: "60秒ブリッツ", boss: "ボスバトル",
    endless: "エンドレス", recognition: "4択・意味つなぎ", strict: "本番入力", puzzle: "復元パズル", article: "条文連続復元"
  }[mode] || "学習";
}

function renderRatingButtons(presentation) {
  if (session.result?.correct === false) return `<div class="rating-row"><button data-action="rate" data-rating="again">次へ</button></div>`;
  const selfGrade = presentation.type === "self-grade" || presentation.type === "full-recall";
  return `<div class="rating-row">
    ${selfGrade ? `<button data-action="rate" data-rating="again">不正解</button>` : ""}
    <button data-action="rate" data-rating="hard">迷った</button>
    <button data-action="rate" data-rating="good">正解</button>
    <button data-action="rate" data-rating="easy">即答</button>
  </div>`;
}

function isGameSession(mode = session?.mode) {
  return Boolean(GAME_MODES[mode] || mode === "article");
}

function sessionAccuracy() {
  const total = session.mode === "boss" ? Math.max(session.targetCount, session.answered) : session.correct + session.wrong;
  return total ? session.correct / total : 0;
}

function persistBossResult() {
  if (session?.mode !== "boss" || !session.stageId || session.bossResultSaved) return;
  session.bossResultSaved = true;
  const pack = packById(session.packId);
  const stage = getPackStages(pack).find(item => item.id === session.stageId);
  const rate = sessionAccuracy();
  const stars = bossStars(rate, stage);
  if (!stars) return;
  const game = gameState();
  const packClears = { ...(game.bossClears[pack.id] || {}) };
  const previous = packClears[stage.id];
  if (!previous || stars > previous.stars || rate > previous.rate) packClears[stage.id] = { stars, rate, date: new Date().toISOString() };
  persistGameState({ ...game, bossClears: { ...game.bossClears, [pack.id]: packClears } }).catch(error => showToast(`ボス記録を保存できませんでした: ${error.message}`));
}

function renderArticleRebuild(pack) {
  const article = session.article;
  const results = session.articleResult || {};
  const resultValues = Object.values(results);
  const allCorrect = resultValues.length > 0 && resultValues.every(Boolean);
  const content = `<main id="main-content" class="study-page"><div class="study-wrap">
    <div class="study-hud"><button class="ghost" data-action="quit-study">中断</button><span class="study-count">条文連続復元 ・ ${session.articleExerciseIds.length}空欄</span></div>
    <article class="question-card article-rebuild-card"><div class="question-meta"><span class="type-chip">条文連続復元</span><span class="subject-chip">${escapeHtml(article.title || `第${article.articleNumber}条`)}</span></div>
      <form id="article-rebuild-form"><div class="article-rebuild-text">${article.segments.map(segment => {
        if (segment.type === "text") return renderRichText(segment.text);
        const exerciseId = `cloze:${segment.blankId}`;
        const value = session.articleValues[exerciseId] || "";
        const result = results[exerciseId];
        return `<input class="inline-rebuild-input ${result == null ? "" : result ? "correct" : "wrong"}" name="${escapeHtml(exerciseId)}" value="${escapeHtml(value)}" autocomplete="off" aria-label="空欄の答え">`;
      }).join("")}</div></form>
      ${resultValues.length ? `<div class="article-result ${allCorrect ? "correct" : "wrong"}"><strong>${resultValues.filter(Boolean).length} / ${resultValues.length} 正解</strong><span>${allCorrect ? `条文を完全復元しました。+${session.xpEarned} XP` : "赤い空欄を直して再挑戦できます。"}</span></div>` : ""}
      <footer class="question-footer"><button class="ghost" data-action="new-article-rebuild" data-pack-id="${escapeHtml(pack.id)}">別の条文</button><button class="primary" type="submit" form="article-rebuild-form">一括判定</button></footer>
    </article></div></main>`;
  app.innerHTML = appShell(content, "study");
}

async function submitArticleRebuild(form) {
  if (!session || session.mode !== "article" || session.saving) return;
  session.saving = true;
  const pack = packById(session.packId);
  const formData = new FormData(form);
  const now = Date.now();
  const outcomes = session.articleExerciseIds.map(exerciseId => {
    const exercise = exerciseById(pack, exerciseId);
    const value = String(formData.get(exerciseId) || "");
    session.articleValues[exerciseId] = value;
    return { exercise, exerciseId, value, grade: getHandler(exercise.type).grade(exercise, value) };
  });
  const allCorrect = outcomes.every(item => item.grade.correct);
  let nextGame = gameState();
  let combo = session.combo;
  try {
    for (let index = 0; index < outcomes.length; index += 1) {
      const item = outcomes[index];
      combo = item.grade.correct ? combo + 1 : 0;
      const previous = progressMap.get(progressKey(pack.id, item.exerciseId));
      const progress = updateMemory(previous, {
        packId: pack.id, exerciseId: item.exerciseId, interactionType: item.exercise.type, correct: item.grade.correct,
        rating: item.grade.correct ? "good" : "again", sessionMode: "article", responseMs: now - session.questionStartedAt
      }, now + index);
      const xp = index === outcomes.length - 1 && allCorrect ? 8 : 0;
      nextGame = gameStateAfterAttempt(nextGame, { correct: item.grade.correct, combo, xp, now });
      const history = {
        id: randomId("attempt"), packId: pack.id, exerciseId: item.exerciseId, interactionType: item.exercise.type,
        originalType: item.exercise.type, correct: item.grade.correct, rating: item.grade.correct ? "good" : "again",
        usedHint: false, responseMs: now - session.questionStartedAt, sessionMode: "article", attemptedAt: now + index,
        xp, combo
      };
      const nextMeta = index === outcomes.length - 1 ? { ...snapshot.meta, game: nextGame } : null;
      await recordAttempt(db, progress, history, nextMeta);
      const existingIndex = snapshot.progress.findIndex(record => record.key === progress.key);
      if (existingIndex >= 0) snapshot.progress[existingIndex] = progress; else snapshot.progress.push(progress);
      snapshot.history.unshift(history);
      progressMap.set(progress.key, progress);
    }
    snapshot.meta = { ...snapshot.meta, game: nextGame };
    session.articleResult = Object.fromEntries(outcomes.map(item => [item.exerciseId, item.grade.correct]));
    session.correct = outcomes.filter(item => item.grade.correct).length;
    session.wrong = outcomes.length - session.correct;
    session.answered = outcomes.length;
    session.combo = combo;
    session.bestCombo = Math.max(session.bestCombo, combo);
    session.xpEarned = allCorrect ? 8 : 0;
    session.questionStartedAt = Date.now();
  } catch (error) {
    showToast(`保存できませんでした: ${error.message}`);
  }
  session.saving = false;
  renderArticleRebuild(pack);
}

function renderStudyResult(pack) {
  const total = session.mode === "boss" ? Math.max(session.targetCount, session.answered) : session.correct + session.wrong;
  const accuracy = total ? Math.round(session.correct / total * 100) : 0;
  const boss = session.mode === "boss";
  if (boss) persistBossResult();
  const stage = boss ? getPackStages(pack).find(item => item.id === session.stageId) : null;
  const stars = boss ? bossStars(accuracy / 100, stage) : 0;
  const won = boss ? accuracy / 100 >= (stage?.clearRate || .8) : true;
  return appShell(`<main id="main-content" class="study-page"><div class="study-wrap"><section class="study-result">
    <div class="result-emblem">${boss ? (won ? "🏆" : "🛡️") : "🎉"}</div><p class="eyebrow">QUEST COMPLETE</p><h1>${boss ? (won ? "ボス撃破！" : "再挑戦しよう") : `${accuracy}%`}</h1><p>${escapeHtml(pack.title)}の学習を保存しました。${session.timedOut ? "制限時間が終了しました。" : ""}</p>
    ${boss ? `<div class="boss-stars" aria-label="ボス評価${stars}">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div><p>${escapeHtml(session.stageName)} ・ ${accuracy >= 80 ? "エリアクリア" : "80%以上でクリア"}</p>` : ""}
    <div class="summary-grid"><div class="summary-card"><strong>+${session.xpEarned || 0}</strong><span>獲得XP</span></div><div class="summary-card"><strong>${session.bestCombo || 0}</strong><span>最大コンボ</span></div><div class="summary-card"><strong>${accuracy}%</strong><span>正答率</span></div><div class="summary-card"><strong>${gameState().dailyStreak}</strong><span>連続学習日</span></div></div>
    <div class="button-row" style="justify-content:center"><button class="primary" data-action="restart-session">もう一度</button><button class="ghost" data-action="quit-study">教材一覧へ</button></div>
  </section></div></main>`, "study");
}

function renderStudy() {
  const pack = packById(session?.packId);
  if (!pack || pack.status !== "active") {
    session = null; currentView = "home"; renderHome(); return;
  }
  if (session.mode === "article") return renderArticleRebuild(pack);
  if (session.mode === "endless" && !session.completed && session.index >= session.queue.length) {
    session.queue = selectGameQueue(pack, progressMap, { mode: "endless", stageId: session.stageId });
    session.index = 0;
  }
  if (session.completed || session.index >= session.queue.length) {
    clearGameTimer();
    session.completed = true;
    app.innerHTML = renderStudyResult(pack);
    return;
  }
  const base = currentBaseExercise();
  const presentation = currentPresentation();
  const handler = getHandler(presentation.type);
  if (!handler) {
    showToast(`未対応の問題形式: ${presentation.type}`);
    session.index += 1; renderStudy(); return;
  }
  const progress = Math.round(session.index / session.queue.length * 100);
  const resourceTitle = pack.resources?.find(resource => resource.id === base.resourceId)?.title;
  const meta = resourceTitle || base.metadata?.unit || base.group || base.source?.sourceKind || pack.subject.name;
  const answerContent = session.result
    ? `${renderFeedback(presentation, session.result)}${renderRatingButtons(presentation)}`
    : `${session.hint ? `<div class="hint-box">${escapeHtml(session.hint)}</div>` : ""}${session.mode === "puzzle" ? renderPuzzleAnswer(presentation) : handler.renderAnswer(presentation)}`;
  const canHint = !session.result && ["text-input", "cloze"].includes(presentation.type);
  const isReveal = ["self-grade", "full-recall"].includes(presentation.type);
  const gameHud = isGameSession() ? `<div class="battle-hud">
    <div><small>${session.mode === "boss" ? "PLAYER HP" : "正解"}</small><strong>${session.mode === "boss" ? `${session.playerHp} HP` : session.correct}</strong><span><i style="width:${session.mode === "boss" ? session.playerHp : Math.min(100, session.correct / Math.max(1, session.answered) * 100)}%"></i></span></div>
    <div class="combo-or-timer"><strong>${session.deadline ? `<span data-game-timer>${session.mode === "blitz" ? `${session.secondsLeft}s` : `${String(Math.floor(session.secondsLeft / 60)).padStart(2, "0")}:${String(session.secondsLeft % 60).padStart(2, "0")}`}</span>` : `${session.combo}×`}</strong><small>${session.deadline ? "TIME" : "COMBO"}</small></div>
    <div><small>${session.mode === "boss" ? "BOSS HP" : "SESSION XP"}</small><strong>${session.mode === "boss" ? `${session.bossHp} HP` : `+${session.xpEarned}`}</strong><span><i style="width:${session.mode === "boss" ? session.bossHp : Math.min(100, session.xpEarned)}%"></i></span></div>
  </div>` : "";
  const content = `<main id="main-content" class="study-page"><div class="study-wrap">
    <div class="study-hud"><button class="ghost" data-action="${session.mode === "endless" ? "finish-game" : "quit-study"}">${session.mode === "endless" ? "終了" : "中断"}</button><div class="progress-track" aria-label="進捗${progress}%"><span style="width:${progress}%"></span></div><span class="study-count">${session.index + 1} / ${session.mode === "endless" ? "∞" : session.queue.length}</span></div>
    ${gameHud}
    <article class="question-card">
      <div class="question-meta"><span class="type-chip">${escapeHtml(handler.label)}</span><span class="subject-chip">${escapeHtml(meta)}</span><span class="status-chip">${escapeHtml(studyModeLabel(session.mode))}</span></div>
      <div class="question-main"><h1>${handler.renderPrompt(presentation)}</h1></div>
      <div class="answer-area">${answerContent}</div>
      ${session.result ? "" : `<footer class="question-footer"><div>${canHint && session.mode !== "boss" && session.mode !== "strict" ? `<button class="text-button" data-action="hint">ヒントを見る</button>` : ""}</div>${isReveal ? "" : `<button class="primary" data-action="${session.mode === "puzzle" ? "puzzle-submit" : "submit-answer"}" ${session.mode === "puzzle" && !session.puzzleSelected.length ? "disabled" : ""}>判定する</button>`}</footer>`}
    </article>
  </div></main>`;
  app.innerHTML = appShell(content, "study");
  requestAnimationFrame(() => document.querySelector("#answer-input, input[name=answer]")?.focus());
}

function renderProgress() {
  const total = aggregateSummary(snapshot.packs);
  const game = gameState();
  const level = levelFromXp(game.xp);
  const badges = unlockedBadges(game, snapshot.progress);
  const accuracyBase = snapshot.progress.reduce((sum, record) => sum + (record.attempts || 0), 0);
  const correct = snapshot.progress.reduce((sum, record) => sum + (record.correct || 0), 0);
  const recent = snapshot.history.slice(0, 30);
  const packRows = snapshot.packs.map(pack => {
    const summary = summarizePack(pack, progressMap);
    return `<div class="manage-item"><div><strong>${escapeHtml(pack.title)}</strong><small>${pack.status === "archived" ? "Archive中 ・ " : ""}${summary.seen}/${summary.total}問 ・ 習熟度${summary.mastery}% ・ 弱点${summary.weak}</small></div><div style="min-width:110px"><div class="progress-track"><span style="width:${summary.mastery}%"></span></div></div></div>`;
  }).join("");
  const content = `<main id="main-content" class="page">
    <div class="page-head"><div><p class="eyebrow">MEMORY EVIDENCE</p><h1>学習記録</h1><p>正誤だけでなく、問題形式・ヒント・迷い・経過日数・回答速度を記録しています。</p></div></div>
    <section class="player-record"><div class="player-avatar">F<span>Lv.${level.level}</span></div><div><p class="eyebrow">PLAYER RECORD</p><h2>${rankName(level.level)}</h2><div class="xp-track"><i style="width:${level.progress}%"></i></div><small>${formatNumber(game.xp)} XP ・ 次まで ${level.required - level.current} XP</small></div></section>
    <section class="summary-grid"><div class="summary-card"><strong>${formatNumber(game.xp)}</strong><span>総XP</span></div><div class="summary-card"><strong>${game.dailyStreak}</strong><span>連続学習日</span></div><div class="summary-card"><strong>${game.bestCombo}</strong><span>最高コンボ</span></div><div class="summary-card"><strong>${total.mastered}</strong><span>安定した項目</span></div><div class="summary-card"><strong>${accuracyBase ? Math.round(correct / accuracyBase * 100) : 0}%</strong><span>総合正答率</span></div><div class="summary-card"><strong>${snapshot.history.length}</strong><span>回答履歴</span></div></section>
    <section class="panel badge-panel"><h2>バッジコレクション</h2><div class="badge-grid">${badges.map(badge => `<div class="badge ${badge.unlocked ? "unlocked" : ""}"><i>${badge.icon}</i><strong>${escapeHtml(badge.name)}</strong></div>`).join("")}</div></section>
    <div class="two-column"><section class="panel"><h2>教材別</h2><div class="manage-list">${packRows || "<p>教材がありません。</p>"}</div></section>
    <section class="panel"><h2>最近の回答</h2><div class="history-list">${recent.length ? recent.map(entry => {
      const pack = packById(entry.packId); const exercise = exerciseById(pack, entry.exerciseId);
      const typeLabel = getHandler(entry.interactionType)?.label || entry.interactionType;
      return `<div class="history-row"><span class="history-result ${entry.correct ? "" : "bad"}">${entry.correct ? "✓" : "×"}</span><span class="history-copy"><strong>${escapeHtml(sourceLabel(exercise || { id: entry.exerciseId, payload: {} }, pack))}</strong><small>${escapeHtml(pack?.title || entry.packId)} ・ ${escapeHtml(typeLabel)}</small></span><span class="history-time">${formatDate(entry.attemptedAt)}</span></div>`;
    }).join("") : "<p>まだ回答履歴がありません。</p>"}</div></section></div>
  </main>`;
  app.innerHTML = appShell(content, "progress");
}

function manageItem(pack) {
  return `<div class="manage-item"><div><strong>${escapeHtml(pack.title)}</strong><small>${escapeHtml(pack.subject.name)} ・ ${pack.exercises.length}問 ・ ${escapeHtml(pack.id)}</small></div><div class="button-row">
    <button class="ghost" data-action="edit-pack" data-pack-id="${escapeHtml(pack.id)}">編集</button>
    <button class="ghost" data-action="duplicate-pack" data-pack-id="${escapeHtml(pack.id)}">複製</button>
    <button class="ghost" data-action="export-pack" data-pack-id="${escapeHtml(pack.id)}">JSON</button>
    <button class="${pack.status === "active" ? "secondary" : "primary"}" data-action="${pack.status === "active" ? "archive-pack" : "restore-pack"}" data-pack-id="${escapeHtml(pack.id)}">${pack.status === "active" ? "Archive" : "Restore"}</button>
    <button class="danger" data-action="delete-pack" data-pack-id="${escapeHtml(pack.id)}">削除</button>
  </div></div>`;
}

function renderManage() {
  const active = snapshot.packs.filter(pack => pack.status === "active");
  const archived = snapshot.packs.filter(pack => pack.status === "archived");
  const content = `<main id="main-content" class="page">
    <div class="page-head"><div><p class="eyebrow">PACK CONTROL</p><h1>教材とバックアップ</h1><p>追加・編集・Archive・Restore・複製をJSON中心で行います。不正なデータは保存前に拒否します。</p></div><button class="primary" data-action="new-pack">空の教材を作る</button></div>
    <section class="manage-grid">
      <article class="panel"><h2>教材JSON</h2><p>Pack JSONを検証・previewしてから追加します。同じIDがある場合は安全な複製を選べます。</p><div class="button-row"><label class="file-button">教材をimport<input id="import-pack" type="file" accept="application/json,.json"></label><button class="ghost" data-action="new-pack">JSON editor</button></div></article>
      <article class="panel"><h2>完全バックアップ</h2><p>教材・進捗・回答履歴・設定を1つのJSONへ保存します。Restoreは全参照を検証してから一括置換します。</p><div class="button-row"><button class="primary" data-action="backup">Backup</button><label class="file-button">Restore<input id="restore-backup" type="file" accept="application/json,.json"></label></div></article>
    </section>
    <div class="section-head"><div><h2>Active</h2><p>通常学習と復習候補に含まれます。</p></div></div><section class="panel"><div class="manage-list">${active.length ? active.map(manageItem).join("") : "<p>Active教材はありません。</p>"}</div></section>
    <div class="section-head"><div><h2>Archive</h2><p>教材・進捗・履歴は保持し、通常学習から除外します。</p></div></div><section class="panel"><div class="manage-list">${archived.length ? archived.map(manageItem).join("") : "<p>Archive中の教材はありません。</p>"}</div></section>
  </main>`;
  app.innerHTML = appShell(content, "manage");
}

function render() {
  if (currentView === "study" && session) renderStudy();
  else if (currentView === "mock" && mockSession) renderMock();
  else if (currentView === "quests") renderQuests();
  else if (currentView === "library") renderLibrary();
  else if (currentView === "progress") renderProgress();
  else if (currentView === "manage") renderManage();
  else renderHome();
}

function navigate(view) {
  clearGameTimer();
  if (view !== "study") session = null;
  if (view !== "mock") {
    clearMockTimer();
    if (currentView === "mock") clearMockStorage();
    mockSession = null;
  }
  currentView = view;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHint() {
  const exercise = currentPresentation();
  const answer = firstAcceptedAnswer(exercise) || firstAcceptedAnswer(currentBaseExercise());
  if (!answer) return;
  const characters = [...String(answer)];
  session.usedHint = true;
  session.hint = `先頭「${characters[0]}」・${characters.length}文字`;
  renderStudy();
}

function submitAnswer() {
  const presentation = currentPresentation();
  const handler = getHandler(presentation.type);
  const response = handler.readResponse(document);
  if (response == null || response === "" || (Array.isArray(response) && !response.length)) {
    showToast("答えを選択または入力してください");
    return;
  }
  session.result = handler.grade(presentation, response);
  session.response = response;
  renderStudy();
}

function submitPuzzle() {
  const presentation = currentPresentation();
  ensurePuzzle(presentation);
  if (!session.puzzleSelected.length) return showToast("タイルを選んでください");
  const response = session.puzzleSelected.map(id => session.puzzleTiles.find(tile => tile.id === id)?.text || "").join("");
  session.result = getHandler(presentation.type).grade(presentation, response);
  session.response = response;
  renderStudy();
}

function revealAnswer() {
  session.result = { correct: null, expected: expectedAnswer(currentPresentation()) };
  renderStudy();
}

function randomId(prefix) {
  return globalThis.crypto?.randomUUID ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function rateAnswer(rating) {
  if (!session || session.saving) return;
  const activeSession = session;
  activeSession.saving = true;
  document.querySelectorAll('[data-action="rate"]').forEach(button => {
    button.disabled = true;
  });
  const pack = packById(activeSession.packId);
  const base = currentBaseExercise();
  const presentation = currentPresentation();
  const selfGrade = ["self-grade", "full-recall"].includes(presentation.type);
  const correct = selfGrade ? rating !== "again" : Boolean(session.result?.correct);
  const now = Date.now();
  const nextCombo = correct ? activeSession.combo + 1 : 0;
  const xp = calculateXp({ correct, combo: nextCombo, exercise: base, responseMs: now - session.questionStartedAt, mode: activeSession.mode });
  const nextGame = gameStateAfterAttempt(gameState(), { correct, combo: nextCombo, xp, now });
  const nextMeta = { ...snapshot.meta, game: nextGame };
  const key = progressKey(pack.id, base.id);
  const previous = progressMap.get(key);
  const progress = updateMemory(previous, {
    packId: pack.id,
    exerciseId: base.id,
    interactionType: presentation.type,
    correct,
    rating: correct ? rating : "again",
    hesitant: rating === "hard",
    usedHint: session.usedHint,
    sessionMode: session.mode,
    responseMs: now - session.questionStartedAt
  }, now);
  const history = {
    id: randomId("attempt"),
    packId: pack.id,
    exerciseId: base.id,
    interactionType: presentation.type,
    originalType: base.type,
    correct,
    rating: correct ? rating : "again",
    usedHint: session.usedHint,
    responseMs: now - session.questionStartedAt,
    sessionMode: session.mode,
    attemptedAt: now,
    xp,
    combo: nextCombo
  };
  try {
    await recordAttempt(db, progress, history, nextMeta);
  } catch (error) {
    activeSession.saving = false;
    document.querySelectorAll('[data-action="rate"]').forEach(button => {
      button.disabled = false;
    });
    showToast(`保存できませんでした: ${error.message}`);
    return;
  }
  const existingIndex = snapshot.progress.findIndex(record => record.key === key);
  if (existingIndex >= 0) snapshot.progress[existingIndex] = progress;
  else snapshot.progress.push(progress);
  snapshot.history.unshift(history);
  snapshot.meta = nextMeta;
  progressMap.set(key, progress);
  activeSession.combo = nextCombo;
  activeSession.bestCombo = Math.max(activeSession.bestCombo, nextCombo);
  activeSession.xpEarned += xp;
  activeSession.answered += 1;
  if (activeSession.mode === "boss") {
    activeSession.damageDealt = (activeSession.damageDealt || 0) + bossDamage({ correct, combo: nextCombo, exercise: base });
    const stage = getPackStages(pack).find(item => item.id === activeSession.stageId);
    const clearRate = stage?.clearRate || .8;
    const correctCount = activeSession.correct + (correct ? 1 : 0);
    const bossRate = correctCount / Math.max(activeSession.targetCount, activeSession.answered);
    activeSession.bossHp = Math.max(0, 100 - Math.round(bossRate / clearRate * 100));
    if (!correct) activeSession.playerHp = Math.max(0, activeSession.playerHp - 22);
  }
  if (correct) {
    activeSession.correct += 1;
    if ([3, 5, 10, 20].includes(nextCombo)) showToast(`${nextCombo}連続正解！`);
  }
  else {
    activeSession.wrong += 1;
    const count = activeSession.retryCounts[base.id] || 0;
    if (count < 2 && activeSession.mode !== "blitz") {
      const prefix = activeSession.queue.slice(0, activeSession.index + 1);
      const remaining = activeSession.queue.slice(activeSession.index + 1);
      const rescheduled = scheduleWrongRetry(remaining, { ...base, __wrongRetry: true });
      if (rescheduled.length > remaining.length) {
        activeSession.queue = [...prefix, ...rescheduled];
        activeSession.retryCounts[base.id] = count + 1;
      }
    }
  }
  activeSession.index += 1;
  activeSession.result = null;
  activeSession.response = null;
  activeSession.presentation = null;
  activeSession.presentationKey = null;
  activeSession.usedHint = false;
  activeSession.hint = "";
  activeSession.puzzleKey = "";
  activeSession.puzzleTiles = [];
  activeSession.puzzleSelected = [];
  activeSession.questionStartedAt = Date.now();
  if (activeSession.mode === "boss" && activeSession.playerHp <= 0) activeSession.completed = true;
  else if (activeSession.mode !== "endless" && activeSession.index >= activeSession.queue.length) activeSession.completed = true;
  activeSession.saving = false;
  if (session === activeSession) renderStudy();
}

function closeModal() {
  if (modal.open) modal.close();
  modal.innerHTML = "";
  pendingImport = null;
  pendingDeleteId = null;
  pendingBackup = null;
}

function openModal(content) {
  modal.innerHTML = content;
  if (!modal.open) modal.showModal();
}

function errorsHtml(errors) {
  return `<div class="validation-box">${errors.slice(0, 20).map(error => `<div><strong>${escapeHtml(error.path)}</strong>: ${escapeHtml(error.message)}</div>`).join("")}${errors.length > 20 ? `<div>ほか${errors.length - 20}件</div>` : ""}</div>`;
}

function newPackTemplate() {
  const now = new Date().toISOString();
  return { schemaVersion: SCHEMA_VERSION, type: PACK_TYPE, id: `my-pack-${Date.now().toString(36)}`, subject: { id: "custom", name: "新しい科目" }, title: "新しい教材", description: "", status: "active", createdAt: now, updatedAt: now, resources: [], exercises: [], metadata: { contentVersion: "1", userEdited: true } };
}

function openPackEditor(pack, isNew = false) {
  openModal(`<form method="dialog" data-form="pack-editor">
    <div class="modal-head"><div><h2>${isNew ? "教材JSONを作成" : "教材JSONを編集"}</h2><p>type別payloadを含むPack全体を検証して保存します。</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="閉じる">×</button></div>
    <div class="modal-body"><textarea id="pack-json" spellcheck="false">${escapeHtml(JSON.stringify(pack, null, 2))}</textarea><div id="editor-errors"></div><div class="modal-actions"><button class="ghost" type="button" data-action="close-modal">キャンセル</button><button class="primary" type="button" data-action="save-pack-editor" data-original-id="${isNew ? "" : escapeHtml(pack.id)}">検証して保存</button></div></div>
  </form>`);
}

function studiedExerciseIds(packId) {
  return new Set(snapshot.progress.filter(record => record.packId === packId && record.attempts > 0).map(record => record.exerciseId));
}

function canReplacePack(existing, candidate) {
  const nextIds = new Set(candidate.exercises.map(exercise => exercise.id));
  return [...studiedExerciseIds(existing.id)].every(id => nextIds.has(id));
}

async function savePackEditor(originalId) {
  const text = modal.querySelector("#pack-json")?.value || "";
  let candidate;
  try { candidate = JSON.parse(text); }
  catch (error) {
    modal.querySelector("#editor-errors").innerHTML = errorsHtml([{ path: "$", message: `JSON構文エラー: ${error.message}` }]); return;
  }
  const validation = validatePack(candidate);
  if (!validation.valid) { modal.querySelector("#editor-errors").innerHTML = errorsHtml(validation.errors); return; }
  if (originalId && candidate.id !== originalId) {
    modal.querySelector("#editor-errors").innerHTML = errorsHtml([{ path: "id", message: "編集中にPack IDは変更できません。複製を使ってください" }]); return;
  }
  const duplicate = snapshot.packs.find(pack => pack.id === candidate.id && pack.id !== originalId);
  if (duplicate) { modal.querySelector("#editor-errors").innerHTML = errorsHtml([{ path: "id", message: "同じPack IDが存在します" }]); return; }
  const existing = originalId ? packById(originalId) : null;
  if (existing && !canReplacePack(existing, candidate)) {
    modal.querySelector("#editor-errors").innerHTML = errorsHtml([{ path: "exercises", message: "学習記録がある問題IDを削除する編集は保存できません。複製して追加してください" }]); return;
  }
  candidate = { ...candidate, updatedAt: new Date().toISOString(), metadata: { ...(candidate.metadata || {}), userEdited: true } };
  await putPack(db, candidate);
  const index = snapshot.packs.findIndex(pack => pack.id === candidate.id);
  if (index >= 0) snapshot.packs[index] = candidate; else snapshot.packs.push(candidate);
  closeModal(); renderManage(); showToast("教材を保存しました");
}

function showPackImport(pack, parseError = null) {
  const validation = parseError ? { valid: false, errors: [{ path: "$", message: parseError }] } : validatePack(pack);
  const existing = validation.valid ? packById(pack.id) : null;
  pendingImport = validation.valid ? pack : null;
  const replacementSafe = existing ? canReplacePack(existing, pack) : true;
  openModal(`<div class="modal-head"><div><h2>教材import preview</h2><p>保存前にschemaと参照関係を確認します。</p></div><button class="icon-button" data-action="close-modal" aria-label="閉じる">×</button></div><div class="modal-body">
    ${validation.valid ? `<div class="preview-grid"><div><strong>${escapeHtml(pack.title)}</strong><span>教材</span></div><div><strong>${pack.exercises.length}</strong><span>問題</span></div><div><strong>${pack.resources.length}</strong><span>資料</span></div></div><p>${existing ? "同じIDの教材があります。複製追加を推奨します。" : "新しい教材として追加できます。"}</p>${existing && !replacementSafe ? `<div class="validation-box">既存の学習記録が参照する問題IDが候補から消えるため、置換はできません。</div>` : ""}` : errorsHtml(validation.errors)}
    <div class="modal-actions"><button class="ghost" data-action="close-modal">キャンセル</button>${validation.valid ? `${existing ? `<button class="secondary" data-action="commit-import" data-mode="duplicate">別IDで複製</button>` : ""}<button class="primary" data-action="commit-import" data-mode="${existing ? "replace" : "add"}" ${replacementSafe ? "" : "disabled"}>${existing ? "同じIDを置換" : "追加"}</button>` : ""}</div>
  </div>`);
}

async function commitPackImport(mode) {
  if (!pendingImport) return;
  let candidate = structuredClone(pendingImport);
  if (mode === "duplicate") candidate = duplicatePack(candidate);
  candidate.metadata = { ...(candidate.metadata || {}), userEdited: true };
  await putPack(db, candidate);
  const index = snapshot.packs.findIndex(pack => pack.id === candidate.id);
  if (index >= 0) snapshot.packs[index] = candidate; else snapshot.packs.push(candidate);
  closeModal(); renderManage(); showToast("教材をimportしました");
}

function showBackupPreview(backup, parseError = null) {
  const validation = parseError ? { valid: false, errors: [{ path: "$", message: parseError }] } : validateBackup(backup);
  pendingBackup = validation.valid ? backup : null;
  openModal(`<div class="modal-head"><div><h2>Backup Restore</h2><p>参照とIDを検証してから、現在の全データを置換します。</p></div><button class="icon-button" data-action="close-modal">×</button></div><div class="modal-body">
    ${validation.valid ? `<div class="preview-grid"><div><strong>${backup.packs.length}</strong><span>教材</span></div><div><strong>${backup.progress.length}</strong><span>進捗</span></div><div><strong>${backup.history.length}</strong><span>履歴</span></div></div><div class="danger-copy">Restoreすると現在の教材・進捗・履歴は、このバックアップの内容へ一括置換されます。</div>` : errorsHtml(validation.errors)}
    <div class="modal-actions"><button class="ghost" data-action="close-modal">キャンセル</button>${validation.valid ? `<button class="danger" data-action="confirm-backup-restore">検証済みデータをRestore</button>` : ""}</div>
  </div>`);
}

async function confirmBackupRestore() {
  if (!pendingBackup) return;
  await replaceFromBackup(db, pendingBackup);
  snapshot = await loadAll(db); refreshMaps(); closeModal(); currentView = "home"; render(); showToast("BackupをRestoreしました");
}

function showDeleteConfirm(pack) {
  pendingDeleteId = pack.id;
  const records = snapshot.progress.filter(record => record.packId === pack.id).length;
  const history = snapshot.history.filter(entry => entry.packId === pack.id).length;
  openModal(`<div class="modal-head"><div><h2>教材を完全削除</h2><p>Archiveとは異なり、元に戻せません。</p></div><button class="icon-button" data-action="close-modal">×</button></div><div class="modal-body"><div class="danger-copy"><strong>${escapeHtml(pack.title)}</strong><br>教材${pack.exercises.length}問、進捗${records}件、履歴${history}件を完全に削除します。必要なら先にBackupしてください。</div><div class="modal-actions"><button class="ghost" data-action="close-modal">キャンセル</button><button class="danger" data-action="confirm-delete">完全削除</button></div></div>`);
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const packId = pendingDeleteId;
  await deletePackCompletely(db, packId);
  snapshot.packs = snapshot.packs.filter(pack => pack.id !== packId);
  snapshot.progress = snapshot.progress.filter(record => record.packId !== packId);
  snapshot.history = snapshot.history.filter(entry => entry.packId !== packId);
  refreshMaps(); closeModal(); renderManage(); showToast("教材と関連記録を完全削除しました");
}

async function setPackStatus(packId, status) {
  const pack = packById(packId);
  if (!pack) return;
  const updated = { ...pack, status, updatedAt: new Date().toISOString() };
  await putPack(db, updated);
  snapshot.packs[snapshot.packs.findIndex(item => item.id === packId)] = updated;
  renderManage();
  showToast(status === "archived" ? "Archiveしました。通常学習から除外されます" : "Restoreしました。進捗付きで学習へ戻りました");
}

async function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "navigate") navigate(button.dataset.view);
    else if (action === "start-game") startGameSession(button.dataset.packId, button.dataset.mode, button.dataset.stageId || "");
    else if (action === "start-article-rebuild" || action === "new-article-rebuild") startArticleRebuild(button.dataset.packId);
    else if (action === "open-library") {
      openLibraryEntryIds.clear();
      libraryState.packId = button.dataset.packId;
      libraryState.sectionId = "";
      currentView = "library";
      renderLibrary();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (action === "library-section") {
      openLibraryEntryIds.clear();
      libraryState.sectionId = button.dataset.sectionId;
      libraryState.group = "all";
      libraryState.favorite = "all";
      libraryState.limit = 60;
      renderLibrary();
    }
    else if (action === "library-more") {
      libraryState.limit += 60;
      renderLibrary(false, true);
    }
    else if (action === "library-open-all" || action === "library-close-all") {
      const shouldOpen = action === "library-open-all";
      document.querySelectorAll("details.cloze-article-card[data-library-entry-id]").forEach(card => {
        card.open = shouldOpen;
        if (shouldOpen) openLibraryEntryIds.add(card.dataset.libraryEntryId);
        else openLibraryEntryIds.delete(card.dataset.libraryEntryId);
      });
    }
    else if (action === "reveal-library-blank") {
      const revealed = button.classList.toggle("revealed");
      button.setAttribute("aria-expanded", String(revealed));
      button.setAttribute("aria-label", revealed ? "答えを隠す" : "答えを表示");
    }
    else if (action === "toggle-favorite") {
      event.preventDefault();
      event.stopPropagation();
      await toggleFavorite(button.dataset.packId, button.dataset.itemId);
    }
    else if (action === "reset-library") {
      Object.assign(libraryState, { query: "", importance: "all", status: "all", favorite: "all", group: "all", limit: 60 });
      renderLibrary();
    }
    else if (action === "start-library") startLibrarySession(libraryState.packId);
    else if (action === "start-library-entry") {
      const entry = libraryFilteredEntries.find(item => item.id === button.dataset.entryId);
      if (entry) startOrderedLibrarySession(libraryState.packId, entry.exerciseIds);
    }
    else if (action === "start-library-from") {
      const startIndex = libraryFilteredEntries.findIndex(item => item.id === button.dataset.entryId);
      if (startIndex >= 0) startOrderedLibrarySession(libraryState.packId, libraryFilteredEntries.slice(startIndex).flatMap(entry => entry.exerciseIds));
    }
    else if (action === "start") startSession(button.dataset.packId, button.dataset.mode);
    else if (action === "start-constitution-mock") startConstitutionMock(button.dataset.packId);
    else if (action === "quit-study") navigate("home");
    else if (action === "finish-game") { session.completed = true; clearGameTimer(); renderStudy(); }
    else if (action === "quit-mock") navigate("home");
    else if (action === "submit-constitution-mock") await submitConstitutionMock(false);
    else if (action === "restart-constitution-mock") startConstitutionMock("constitution-quest");
    else if (action === "mock-review-wrong") {
      const wrongIds = mockSession?.result?.items.filter(item => !item.correct).map(item => item.exerciseId) || [];
      const packId = mockSession?.packId;
      navigate("home");
      if (wrongIds.length) startLibrarySession(packId, wrongIds);
    }
    else if (action === "restart-session") {
      if (session.mode === "library") startLibrarySession(session.packId, session.sourceExerciseIds);
      else if (session.mode === "article") startArticleRebuild(session.packId);
      else if (isGameSession(session.mode)) startGameSession(session.packId, session.mode, session.stageId);
      else startSession(session.packId, session.mode);
    }
    else if (action === "submit-answer") submitAnswer();
    else if (action === "puzzle-add") { if (!session.puzzleSelected.includes(button.dataset.tileId)) session.puzzleSelected.push(button.dataset.tileId); renderStudy(); }
    else if (action === "puzzle-undo") { session.puzzleSelected.pop(); renderStudy(); }
    else if (action === "puzzle-submit") submitPuzzle();
    else if (action === "reveal") revealAnswer();
    else if (action === "hint") showHint();
    else if (action === "rate") await rateAnswer(button.dataset.rating);
    else if (action === "new-pack") openPackEditor(newPackTemplate(), true);
    else if (action === "edit-pack") openPackEditor(packById(button.dataset.packId));
    else if (action === "save-pack-editor") await savePackEditor(button.dataset.originalId);
    else if (action === "duplicate-pack") {
      const clone = duplicatePack(packById(button.dataset.packId)); await putPack(db, clone); snapshot.packs.push(clone); renderManage(); showToast("教材を複製しました");
    } else if (action === "export-pack") {
      const pack = packById(button.dataset.packId); downloadJson(`${pack.id}.json`, pack);
    } else if (action === "archive-pack") await setPackStatus(button.dataset.packId, "archived");
    else if (action === "restore-pack") await setPackStatus(button.dataset.packId, "active");
    else if (action === "delete-pack") showDeleteConfirm(packById(button.dataset.packId));
    else if (action === "confirm-delete") await confirmDelete();
    else if (action === "backup") downloadJson(`memory-foundry-backup-${new Date().toISOString().slice(0, 10)}.json`, createBackup(snapshot));
    else if (action === "commit-import") await commitPackImport(button.dataset.mode);
    else if (action === "confirm-backup-restore") await confirmBackupRestore();
    else if (action === "close-modal") closeModal();
  } catch (error) {
    console.error(error);
    showToast(error.message || "処理に失敗しました");
  }
}

async function handleFile(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files?.[0]) return;
  const file = input.files[0];
  let value;
  try { value = JSON.parse(await file.text()); }
  catch (error) {
    if (input.id === "restore-backup") showBackupPreview(null, `JSON構文エラー: ${error.message}`);
    else showPackImport(null, `JSON構文エラー: ${error.message}`);
    input.value = ""; return;
  }
  if (input.id === "restore-backup") showBackupPreview(value);
  else if (value?.type === BACKUP_TYPE) showBackupPreview(value);
  else showPackImport(value);
  input.value = "";
}

function handleLibraryChange(event) {
  const control = event.target.closest("[data-library-filter]");
  if (!control) return;
  const key = control.dataset.libraryFilter;
  if (key === "packId") {
    openLibraryEntryIds.clear();
    libraryState.packId = control.value;
    libraryState.sectionId = "";
  } else {
    libraryState[key] = control.value;
  }
  libraryState.limit = 60;
  renderLibrary();
}

function handleQuestChange(event) {
  if (!event.target.matches("[data-quest-pack]")) return;
  questState.packId = event.target.value;
  questState.stageId = "";
  renderQuests();
}

function handleSubmit(event) {
  if (event.target.id !== "article-rebuild-form") return;
  event.preventDefault();
  submitArticleRebuild(event.target);
}

function handleLibraryToggle(event) {
  const card = event.target.closest?.("details[data-library-entry-id]");
  if (!card) return;
  if (card.open) openLibraryEntryIds.add(card.dataset.libraryEntryId);
  else openLibraryEntryIds.delete(card.dataset.libraryEntryId);
}

function handleLibraryInput(event) {
  if (!event.target.matches("[data-library-search]")) return;
  libraryState.query = event.target.value;
  libraryState.limit = 60;
  if (librarySearchComposing || event.isComposing) return;
  renderLibrary(true);
}

function handleLibraryCompositionStart(event) {
  if (event.target.matches("[data-library-search]")) librarySearchComposing = true;
}

function handleLibraryCompositionEnd(event) {
  if (!event.target.matches("[data-library-search]")) return;
  librarySearchComposing = false;
  libraryState.query = event.target.value;
  libraryState.limit = 60;
  renderLibrary(true);
}

function handleKeyboard(event) {
  if (currentView !== "study" || !session || session.result || modal.open) return;
  const presentation = currentPresentation();
  if (/^[1-9]$/.test(event.key) && ["single-choice", "multiple-choice", "true-false"].includes(presentation.type)) {
    const inputs = [...document.querySelectorAll("input[name=answer]")];
    const input = inputs[Number(event.key) - 1];
    if (input) { input.checked = presentation.type === "multiple-choice" ? !input.checked : true; event.preventDefault(); }
  }
  if (event.key === "Enter" && !event.isComposing && !["self-grade", "full-recall"].includes(presentation.type)) {
    event.preventDefault(); submitAnswer();
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js?v=1.6.1", { scope: "./" });
    if (registration.waiting) showToast("更新があります。アプリを開き直してください");
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showToast("更新を取得しました。次に開くと反映されます");
      });
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function readBuiltinBundle(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Some static hosting/proxy layers prepend a plain-text Warning line to
    // otherwise valid JSON. Accept only a complete object in that narrow case.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (raw.trimStart().startsWith("Warning:") && start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // Fall through with a diagnostic that includes the actual response.
      }
    }
    const prefix = raw.trim().slice(0, 96).replace(/\s+/g, " ");
    throw new Error(`教材データJSONを読めません (${prefix || error.message})`);
  }
}

async function init() {
  try {
    db = await openStorage();
    snapshot = await loadAll(db);
    let bundle = null;
    try {
      const response = await fetch("./data/builtin-packs.json?v=1.6.1", { cache: "no-store" });
      if (!response.ok) throw new Error(`教材データ HTTP ${response.status}`);
      bundle = await readBuiltinBundle(response);
      if (bundle.schemaVersion !== SCHEMA_VERSION || !Array.isArray(bundle.packs)) throw new Error("組み込み教材bundleが不正です");
    } catch (error) {
      if (!snapshot.packs.length) throw error;
      console.warn("Using installed packs because builtin bundle could not be loaded", error);
    }
    if (bundle) {
      const synced = await syncBuiltinPacks(db, bundle, snapshot.packs, snapshot.meta);
      snapshot.packs = synced.packs;
      snapshot.meta = synced.meta;
    }
    refreshMaps();
    const restoredMock = restoreMockSession();
    const restoredPack = restoredMock ? packById(restoredMock.packId) : null;
    if (restoredMock && restoredPack?.status === "active") {
      mockSession = restoredMock;
      currentView = "mock";
    }
    render();
    if (mockSession) startMockTimer();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<main id="main-content" class="loading-shell"><p class="eyebrow">STARTUP ERROR</p><h1>起動できませんでした</h1><p>${escapeHtml(error.message)}</p><button class="primary" onclick="location.reload()">再読み込み</button></main>`;
  }
}

app.addEventListener("click", handleClick);
app.addEventListener("change", handleFile);
app.addEventListener("change", handleLibraryChange);
app.addEventListener("change", handleQuestChange);
app.addEventListener("submit", handleSubmit);
app.addEventListener("input", handleLibraryInput);
app.addEventListener("input", handleMockInput);
app.addEventListener("compositionstart", handleLibraryCompositionStart);
app.addEventListener("compositionend", handleLibraryCompositionEnd);
app.addEventListener("toggle", handleLibraryToggle, true);
modal.addEventListener("click", handleClick);
document.addEventListener("keydown", handleKeyboard);
modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });

init();
