import test from "node:test";
import assert from "node:assert/strict";
import { renderRichText } from "../src/core.js";
import { getHandler, renderFeedback } from "../src/exercise-registry.js";

test("rich text escapes untrusted HTML while rendering chemistry markup", () => {
  const html = renderRichText('<img src=x onerror=alert(1)> [[chem:Fe^{3+}]]');
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('<span class="chem">Fe^{3+}</span>'));
});

test("important renderer outputs include accessible controls", () => {
  const choice = { id: "c", type: "single-choice", payload: { prompt: "問題", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "a" } };
  const input = { id: "i", type: "text-input", payload: { prompt: "問題", acceptedAnswers: ["答え"] } };
  assert.match(getHandler("single-choice").renderAnswer(choice), /input type="radio"/);
  assert.match(getHandler("text-input").renderAnswer(input), /autocomplete="off"/);
  assert.match(getHandler("full-recall").renderAnswer({ payload: {} }), /data-action="reveal"/);
});

test("feedback keeps confusion traps and related pairs visible", () => {
  const exercise = { id: "i", type: "text-input", payload: { prompt: "手がかり", acceptedAnswers: ["IMF"], explanation: "IBRDと混同しない", pair: "ブレトンウッズ体制" } };
  const html = renderFeedback(exercise, { correct: true });
  assert.ok(html.includes("IBRDと混同しない"));
  assert.ok(html.includes("ブレトンウッズ体制"));
});

