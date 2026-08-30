const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s\u3000、。，．,.・･「」『』（）()［］\[\]{}]/g, "").trim();

function optionIds(payload, path, add) {
  const options = payload.options;
  if (!Array.isArray(options) || options.length < 2) {
    add(`${path}.options`, "options は2件以上必要です");
    return new Set();
  }
  const ids = new Set();
  options.forEach((option, index) => {
    if (!option || typeof option !== "object" || !nonEmpty(option.id) || !nonEmpty(option.text)) {
      add(`${path}.options[${index}]`, "id と text が必要です");
      return;
    }
    if (ids.has(option.id)) add(`${path}.options[${index}].id`, "選択肢IDが重複しています");
    ids.add(option.id);
  });
  return ids;
}

function inputAnswers(payload, path, add) {
  if (!Array.isArray(payload.acceptedAnswers) || !payload.acceptedAnswers.length || payload.acceptedAnswers.some(answer => !nonEmpty(answer))) {
    add(`${path}.acceptedAnswers`, "1件以上の正答文字列が必要です");
  }
}

export const EXERCISE_TYPES = Object.freeze({
  "single-choice": Object.freeze({
    recallWeight: 0.56,
    validate(payload, path, add) {
      if (!nonEmpty(payload.prompt)) add(`${path}.prompt`, "問題文が必要です");
      const ids = optionIds(payload, path, add);
      if (!nonEmpty(payload.correctOptionId) || !ids.has(payload.correctOptionId)) add(`${path}.correctOptionId`, "正解選択肢が存在しません");
    },
    grade(payload, response) { return { correct: response === payload.correctOptionId, expected: payload.correctOptionId }; }
  }),
  "multiple-choice": Object.freeze({
    recallWeight: 0.7,
    validate(payload, path, add) {
      if (!nonEmpty(payload.prompt)) add(`${path}.prompt`, "問題文が必要です");
      const ids = optionIds(payload, path, add);
      if (!Array.isArray(payload.correctOptionIds) || !payload.correctOptionIds.length) add(`${path}.correctOptionIds`, "正解選択肢が必要です");
      else {
        if (new Set(payload.correctOptionIds).size !== payload.correctOptionIds.length) add(`${path}.correctOptionIds`, "正解IDが重複しています");
        payload.correctOptionIds.forEach(id => { if (!ids.has(id)) add(`${path}.correctOptionIds`, `存在しない選択肢ID: ${id}`); });
      }
    },
    grade(payload, response) {
      const actual = [...new Set(Array.isArray(response) ? response : [])].sort();
      const expected = [...new Set(payload.correctOptionIds || [])].sort();
      return { correct: actual.length === expected.length && actual.every((value, index) => value === expected[index]), expected };
    }
  }),
  "true-false": Object.freeze({
    recallWeight: 0.42,
    validate(payload, path, add) {
      if (!nonEmpty(payload.statement)) add(`${path}.statement`, "正誤文が必要です");
      if (typeof payload.answer !== "boolean") add(`${path}.answer`, "answer は真偽値で指定します");
    },
    grade(payload, response) {
      const actual = response === true || response === "true" ? true : response === false || response === "false" ? false : null;
      return { correct: actual === payload.answer, expected: payload.answer };
    }
  }),
  "text-input": Object.freeze({
    recallWeight: 0.9,
    validate(payload, path, add) {
      if (!nonEmpty(payload.prompt)) add(`${path}.prompt`, "問題文が必要です");
      inputAnswers(payload, path, add);
    },
    grade(payload, response) {
      const actual = normalize(response);
      return { correct: Boolean(actual) && payload.acceptedAnswers.some(answer => normalize(answer) === actual), expected: payload.acceptedAnswers };
    }
  }),
  "cloze": Object.freeze({
    recallWeight: 0.94,
    validate(payload, path, add) {
      if (!nonEmpty(payload.answer)) add(`${path}.answer`, "空欄の答えが必要です");
      inputAnswers(payload, path, add);
      if (typeof payload.before !== "string" || typeof payload.after !== "string") add(path, "before と after は文字列で指定します");
    },
    grade(payload, response) {
      const actual = normalize(response);
      return { correct: Boolean(actual) && payload.acceptedAnswers.some(answer => normalize(answer) === actual), expected: payload.acceptedAnswers };
    }
  }),
  "self-grade": Object.freeze({
    recallWeight: 0.9,
    validate(payload, path, add) {
      if (!nonEmpty(payload.prompt) || !nonEmpty(payload.answer)) add(path, "prompt と answer が必要です");
    },
    grade(payload) { return { correct: null, expected: payload.answer }; }
  }),
  "full-recall": Object.freeze({
    recallWeight: 1,
    validate(payload, path, add) {
      if (!nonEmpty(payload.prompt)) add(`${path}.prompt`, "問題文が必要です");
      inputAnswers(payload, path, add);
    },
    grade(payload, response) {
      if (response == null) return { correct: null, expected: payload.acceptedAnswers };
      const actual = normalize(response);
      return { correct: Boolean(actual) && payload.acceptedAnswers.some(answer => normalize(answer) === actual), expected: payload.acceptedAnswers };
    }
  })
});

export function getExerciseTypeDefinition(type) {
  return EXERCISE_TYPES[type] || null;
}
