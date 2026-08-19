import { escapeHtml, gradeExercise, renderRichText } from "./core.js?v=1.0.2";

function explanation(payload) {
  return payload.explanation || payload.related || payload.caution || "";
}

function answerText(exercise) {
  const payload = exercise.payload || {};
  if (exercise.type === "single-choice") return payload.options?.find(option => option.id === payload.correctOptionId)?.text || payload.correctOptionId;
  if (exercise.type === "multiple-choice") return (payload.options || []).filter(option => payload.correctOptionIds?.includes(option.id)).map(option => option.text).join(" / ");
  if (exercise.type === "true-false") return payload.answer ? "正しい" : "誤り";
  if (exercise.type === "full-recall") return payload.acceptedAnswers?.[0] || "";
  if (["text-input", "cloze"].includes(exercise.type)) return (payload.acceptedAnswers || [payload.answer]).filter(Boolean).join(" / ");
  return payload.answer || "";
}

function renderChoice(exercise, multiple = false) {
  const payload = exercise.payload;
  const inputType = multiple ? "checkbox" : "radio";
  return `<div class="answer-options" role="group" aria-label="選択肢">${payload.options.map((option, index) => `
    <label class="answer-option"><input type="${inputType}" name="answer" value="${escapeHtml(option.id)}"><span class="shortcut">${index + 1}</span><span>${renderRichText(option.text)}</span></label>
  `).join("")}</div>`;
}

export const registry = Object.freeze({
  "single-choice": {
    label: "選択",
    renderPrompt: exercise => renderRichText(exercise.payload.prompt),
    renderAnswer: exercise => renderChoice(exercise, false),
    readResponse: root => root.querySelector("input[name=answer]:checked")?.value ?? null,
    grade: gradeExercise
  },
  "multiple-choice": {
    label: "複数選択",
    renderPrompt: exercise => renderRichText(exercise.payload.prompt),
    renderAnswer: exercise => renderChoice(exercise, true),
    readResponse: root => [...root.querySelectorAll("input[name=answer]:checked")].map(input => input.value),
    grade: gradeExercise
  },
  "true-false": {
    label: "正誤",
    renderPrompt: exercise => renderRichText(exercise.payload.statement),
    renderAnswer: () => `<div class="answer-options two"><label class="answer-option"><input type="radio" name="answer" value="true"><span class="shortcut">1</span><span>正しい</span></label><label class="answer-option"><input type="radio" name="answer" value="false"><span class="shortcut">2</span><span>誤り</span></label></div>`,
    readResponse: root => root.querySelector("input[name=answer]:checked")?.value ?? null,
    grade: gradeExercise
  },
  "text-input": {
    label: "入力",
    renderPrompt: exercise => renderRichText(exercise.payload.prompt),
    renderAnswer: exercise => `<label class="text-answer"><span>答え</span><input id="answer-input" name="answer" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${exercise.payload.strict ? "完全一致で入力" : "語句を入力"}"></label>`,
    readResponse: root => root.querySelector("input[name=answer]")?.value ?? "",
    grade: gradeExercise
  },
  "cloze": {
    label: "穴埋め",
    renderPrompt: exercise => `<span class="cloze-context">${renderRichText(exercise.payload.before)}</span><span class="blank-slot" aria-label="空欄">？</span><span class="cloze-context">${renderRichText(exercise.payload.after)}</span>`,
    renderAnswer: () => `<label class="text-answer"><span>空欄</span><input id="answer-input" name="answer" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="空欄の語句を入力"></label>`,
    readResponse: root => root.querySelector("input[name=answer]")?.value ?? "",
    grade: gradeExercise
  },
  "self-grade": {
    label: "自己評価",
    renderPrompt: exercise => renderRichText(exercise.payload.prompt),
    renderAnswer: () => `<button class="primary wide" data-action="reveal">答えを見る</button>`,
    readResponse: () => null,
    grade: gradeExercise
  },
  "full-recall": {
    label: "全文想起",
    renderPrompt: exercise => renderRichText(exercise.payload.prompt),
    renderAnswer: () => `<button class="primary wide" data-action="reveal">全文を表示して自己評価</button>`,
    readResponse: () => null,
    grade: gradeExercise
  }
});

export function getHandler(type) {
  return registry[type] || null;
}

export function renderFeedback(exercise, result) {
  const payload = exercise.payload || {};
  return `<div class="feedback ${result?.correct === false ? "is-wrong" : "is-correct"}">
    <p class="feedback-label">${result?.correct === false ? "もう一度覚える" : "答え"}</p>
    <div class="expected-answer">${renderRichText(answerText(exercise))}</div>
    ${explanation(payload) ? `<div class="explanation">${renderRichText(explanation(payload))}</div>` : ""}
    ${payload.pair ? `<div class="explanation"><strong>関連ペア:</strong> ${renderRichText(payload.pair)}</div>` : ""}
    ${payload.caution ? `<div class="caution">注意: ${renderRichText(payload.caution)}</div>` : ""}
  </div>`;
}

export function expectedAnswer(exercise) {
  return answerText(exercise);
}

