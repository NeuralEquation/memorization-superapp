/* Pure learning helpers, also available to the Node checks. */
(function (root) {
  const shuffle = (items, random = Math.random) => { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const normalized = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').trim();
  const filterWords = (words, from, to, starred, state) => words.filter(w => w.id >= from && w.id <= to && (!starred || !!state[w.id]?.star));
  function choicesFor(word, pool, random = Math.random) {
    const correct = word.meanings.join(' / '), own = new Set(word.meanings.map(normalized));
    const choices = []; const used = new Set([normalized(correct)]);
    for (const w of shuffle(pool, random)) {
      if (w.id === word.id || w.meanings.some(m => own.has(normalized(m)))) continue;
      const label = w.meanings.join(' / '), key = normalized(label);
      if (!key || used.has(key)) continue;
      used.add(key); choices.push({id:w.id, label}); if (choices.length === 3) break;
    }
    return choices.length === 3 ? shuffle([{id:word.id, label:correct}, ...choices], random) : null;
  }
  function validateBackup(value, validIds) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'kotonoha-337' || value.version !== 1 || !value.progress || typeof value.progress !== 'object' || Array.isArray(value.progress)) throw Error('バックアップの形式を確認してください。');
    const allowed = new Set(validIds.map(String)), clean = {};
    for (const [id, p] of Object.entries(value.progress)) {
      if (!allowed.has(id) || !p || typeof p !== 'object' || Array.isArray(p)) throw Error('単語番号または学習記録が不正です。');
      if (typeof p.star !== 'boolean' || !['', 'known', 'unsure', 'unknown'].includes(p.rating) || !Number.isSafeInteger(p.attempts) || p.attempts < 0 || !Number.isSafeInteger(p.correct) || p.correct < 0 || p.correct > p.attempts) throw Error('学習記録の値が不正です。');
      clean[id] = {star:p.star, rating:p.rating, attempts:p.attempts, correct:p.correct};
    }
    return clean;
  }
  const api = {shuffle, filterWords, choicesFor, validateBackup};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KotonohaEngine = api;
})(typeof window === 'undefined' ? globalThis : window);
