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
} from "./core.js?v=1.0.2";
import { expectedAnswer, getHandler, renderFeedback } from "./exercise-registry.js?v=1.0.2";
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
} from "./storage.js?v=1.0.2";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal");

let db;
let snapshot = { meta: {}, packs: [], progress: [], history: [] };
let progressMap = new Map();
let currentView = "home";
let session = null;
let pendingImport = null;
let pendingDeleteId = null;
let pendingBackup = null;
let toastTimer = null;

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

function packById(packId) {
  return snapshot.packs.find(pack => pack.id === packId) || null;
}

function exerciseById(pack, exerciseId) {
  return pack?.exercises.find(exercise => exercise.id === exerciseId) || null;
}

function sourceLabel(exercise) {
  return exercise.metadata?.topic || exercise.payload?.heading || exercise.source?.legacyId || exercise.id;
}

function descriptionFor(pack) {
  if (pack.description) return pack.description;
  if (pack.id === "seikei-memorization") return "概念ペアと問題集級の正誤232問を、入力と判断で反復します。";
  if (pack.id === "inorganic-chemistry") return "選択・複数選択・反応式・短答を、化学表記を保ったまま学習します。";
  if (pack.id === "constitution-quest") return "条文104本、空欄288問、全文想起を章構造と出典付きで学びます。";
  return "JSONから追加した暗記教材です。";
}

function appShell(content, active = currentView) {
  return `<div class="app-shell">
    <header class="site-header">
      <div class="header-inner">
        <button class="brand" data-action="navigate" data-view="home" aria-label="教材一覧へ">
          <span class="brand-mark">F</span>
          <span class="brand-copy"><strong>暗記Foundry</strong><small>LOCAL MEMORY WORKSPACE</small></span>
        </button>
        <nav class="main-nav" aria-label="メインメニュー">
          <button class="nav-button ${active === "home" ? "active" : ""}" data-action="navigate" data-view="home">教材</button>
          <button class="nav-button ${active === "progress" ? "active" : ""}" data-action="navigate" data-view="progress">学習記録</button>
          <button class="nav-button ${active === "manage" ? "active" : ""}" data-action="navigate" data-view="manage">管理</button>
        </nav>
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
      </div>
    </div>
  </article>`;
}

function renderHome() {
  const packs = snapshot.packs.filter(pack => pack.status === "active");
  const summary = aggregateSummary(packs);
  const nextPack = packs.find(pack => summarizePack(pack, progressMap).due > 0) || packs[0];
  const content = `<main id="main-content" class="page">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">CHOOSE. RECALL. STRENGTHEN.</p>
        <h1>今、覚える教材を<br>すぐ始める。</h1>
        <p>未学習・誤答・迷い・復習期限をまとめて判断し、価値の高い問題から出題します。教材と記録はこの端末内に保存されます。</p>
      </div>
      <aside class="hero-aside">
        <div><p class="eyebrow">MEMORY SNAPSHOT</p><h2>${nextPack ? "次に取り組むなら" : "教材を追加してください"}</h2>${nextPack ? `<p>${escapeHtml(nextPack.title)}</p>` : ""}</div>
        <div class="hero-metrics">
          <div class="hero-metric"><strong>${formatNumber(summary.mastered)}</strong><span>安定した項目</span></div>
          <div class="hero-metric"><strong>${formatNumber(summary.due + summary.wrong)}</strong><span>優先復習</span></div>
        </div>
        ${nextPack ? `<button class="primary wide" data-action="start" data-pack-id="${escapeHtml(nextPack.id)}" data-mode="recommended">この教材を始める</button>` : `<button class="primary wide" data-action="navigate" data-view="manage">教材を追加</button>`}
      </aside>
    </section>
    <div class="section-head"><div><h2>Active教材</h2><p>教材を選ぶと、そのまま学習を開始できます。</p></div><button class="ghost" data-action="navigate" data-view="manage">教材を管理</button></div>
    <section class="pack-grid" aria-label="Active教材一覧">
      ${packs.length ? packs.map(packCard).join("") : `<div class="empty-state"><h3>Active教材がありません</h3><p>Archiveから戻すか、教材JSONを追加してください。</p><button class="primary" data-action="navigate" data-view="manage">管理を開く</button></div>`}
    </section>
  </main>`;
  app.innerHTML = appShell(content, "home");
}

function getStudyPool(pack, mode) {
  if (mode === "full") return pack.exercises.filter(exercise => exercise.type === "full-recall");
  return pack.exercises.filter(exercise => exercise.type !== "full-recall");
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
  session = {
    packId,
    mode,
    queue,
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
    completed: false
  };
  currentView = "study";
  render();
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
  session.presentation = session.mode === "recommended" && !(record?.attempts) ? recognitionVersion(pack, base) : base;
  session.presentationKey = key;
  return session.presentation;
}

function studyModeLabel(mode) {
  return { recommended: "おすすめ学習", weak: "弱点復習", cram: "試験直前", full: "全文想起" }[mode] || "学習";
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

function renderStudyResult(pack) {
  const total = session.correct + session.wrong;
  const accuracy = total ? Math.round(session.correct / total * 100) : 0;
  return appShell(`<main id="main-content" class="study-page"><div class="study-wrap"><section class="study-result">
    <p class="eyebrow">SESSION COMPLETE</p><h1>${accuracy}%</h1><p>${escapeHtml(pack.title)}の学習を保存しました。同日中のやり直しは長期定着として過大評価しません。</p>
    <div class="summary-grid"><div class="summary-card"><strong>${session.correct}</strong><span>正解</span></div><div class="summary-card"><strong>${session.wrong}</strong><span>不正解</span></div><div class="summary-card"><strong>${total}</strong><span>回答</span></div><div class="summary-card"><strong>${Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000))}</strong><span>分</span></div></div>
    <div class="button-row" style="justify-content:center"><button class="primary" data-action="restart-session">もう一度</button><button class="ghost" data-action="quit-study">教材一覧へ</button></div>
  </section></div></main>`, "study");
}

function renderStudy() {
  const pack = packById(session?.packId);
  if (!pack || pack.status !== "active") {
    session = null; currentView = "home"; renderHome(); return;
  }
  if (session.completed || session.index >= session.queue.length) {
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
  const meta = base.metadata?.unit || base.group || base.source?.sourceKind || pack.subject.name;
  const answerContent = session.result
    ? `${renderFeedback(presentation, session.result)}${renderRatingButtons(presentation)}`
    : `${session.hint ? `<div class="hint-box">${escapeHtml(session.hint)}</div>` : ""}${handler.renderAnswer(presentation)}`;
  const canHint = !session.result && ["text-input", "cloze"].includes(presentation.type);
  const isReveal = ["self-grade", "full-recall"].includes(presentation.type);
  const content = `<main id="main-content" class="study-page"><div class="study-wrap">
    <div class="study-hud"><button class="ghost" data-action="quit-study">中断</button><div class="progress-track" aria-label="進捗${progress}%"><span style="width:${progress}%"></span></div><span class="study-count">${session.index + 1} / ${session.queue.length}</span></div>
    <article class="question-card">
      <div class="question-meta"><span class="type-chip">${escapeHtml(handler.label)}</span><span class="subject-chip">${escapeHtml(meta)}</span><span class="status-chip">${escapeHtml(studyModeLabel(session.mode))}</span></div>
      <div class="question-main"><h1>${handler.renderPrompt(presentation)}</h1></div>
      <div class="answer-area">${answerContent}</div>
      ${session.result ? "" : `<footer class="question-footer"><div>${canHint ? `<button class="text-button" data-action="hint">ヒントを見る</button>` : ""}</div>${isReveal ? "" : `<button class="primary" data-action="submit-answer">判定する</button>`}</footer>`}
    </article>
  </div></main>`;
  app.innerHTML = appShell(content, "study");
  requestAnimationFrame(() => document.querySelector("#answer-input, input[name=answer]")?.focus());
}

function renderProgress() {
  const total = aggregateSummary(snapshot.packs);
  const accuracyBase = snapshot.progress.reduce((sum, record) => sum + (record.attempts || 0), 0);
  const correct = snapshot.progress.reduce((sum, record) => sum + (record.correct || 0), 0);
  const recent = snapshot.history.slice(0, 30);
  const packRows = snapshot.packs.map(pack => {
    const summary = summarizePack(pack, progressMap);
    return `<div class="manage-item"><div><strong>${escapeHtml(pack.title)}</strong><small>${pack.status === "archived" ? "Archive中 ・ " : ""}${summary.seen}/${summary.total}問 ・ 習熟度${summary.mastery}% ・ 弱点${summary.weak}</small></div><div style="min-width:110px"><div class="progress-track"><span style="width:${summary.mastery}%"></span></div></div></div>`;
  }).join("");
  const content = `<main id="main-content" class="page">
    <div class="page-head"><div><p class="eyebrow">MEMORY EVIDENCE</p><h1>学習記録</h1><p>正誤だけでなく、問題形式・ヒント・迷い・経過日数・回答速度を記録しています。</p></div></div>
    <section class="summary-grid"><div class="summary-card"><strong>${total.mastered}</strong><span>安定した項目</span></div><div class="summary-card"><strong>${accuracyBase ? Math.round(correct / accuracyBase * 100) : 0}%</strong><span>総合正答率</span></div><div class="summary-card"><strong>${total.wrong}</strong><span>最近のミス</span></div><div class="summary-card"><strong>${snapshot.history.length}</strong><span>回答履歴</span></div></section>
    <div class="two-column"><section class="panel"><h2>教材別</h2><div class="manage-list">${packRows || "<p>教材がありません。</p>"}</div></section>
    <section class="panel"><h2>最近の回答</h2><div class="history-list">${recent.length ? recent.map(entry => {
      const pack = packById(entry.packId); const exercise = exerciseById(pack, entry.exerciseId);
      return `<div class="history-row"><span class="history-result ${entry.correct ? "" : "bad"}">${entry.correct ? "✓" : "×"}</span><span class="history-copy"><strong>${escapeHtml(sourceLabel(exercise || { id: entry.exerciseId, payload: {} }))}</strong><small>${escapeHtml(pack?.title || entry.packId)} ・ ${escapeHtml(entry.interactionType)}</small></span><span class="history-time">${formatDate(entry.attemptedAt)}</span></div>`;
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
  else if (currentView === "progress") renderProgress();
  else if (currentView === "manage") renderManage();
  else renderHome();
}

function navigate(view) {
  if (view !== "study") session = null;
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
    attemptedAt: now
  };
  try {
    await recordAttempt(db, progress, history);
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
  progressMap.set(key, progress);
  if (correct) activeSession.correct += 1;
  else {
    activeSession.wrong += 1;
    const count = activeSession.retryCounts[base.id] || 0;
    if (count < 2) {
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
  activeSession.questionStartedAt = Date.now();
  if (activeSession.index >= activeSession.queue.length) activeSession.completed = true;
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
    else if (action === "start") startSession(button.dataset.packId, button.dataset.mode);
    else if (action === "quit-study") navigate("home");
    else if (action === "restart-session") startSession(session.packId, session.mode);
    else if (action === "submit-answer") submitAnswer();
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
    const registration = await navigator.serviceWorker.register("./sw.js?v=1.0.2", { scope: "./" });
    if (registration.waiting) showToast("更新準備完了。アプリを閉じて開き直すと反映されます");
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showToast("更新を取得しました。次回起動時に安全に反映します");
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
      const response = await fetch("./data/builtin-packs.json?v=1.0.2", { cache: "no-store" });
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
    render();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<main id="main-content" class="loading-shell"><p class="eyebrow">STARTUP ERROR</p><h1>起動できませんでした</h1><p>${escapeHtml(error.message)}</p><button class="primary" onclick="location.reload()">再読み込み</button></main>`;
  }
}

app.addEventListener("click", handleClick);
app.addEventListener("change", handleFile);
modal.addEventListener("click", handleClick);
document.addEventListener("keydown", handleKeyboard);
modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });

init();

