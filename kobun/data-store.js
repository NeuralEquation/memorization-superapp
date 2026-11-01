(function (root) {
  'use strict';
  const DB_NAME = 'kotonoha337-content-v1', STORE = 'datasets';
  const text = (value, max = 10000) => {
    if (typeof value !== 'string' || value.length > max) throw Error('教材データの文字列が不正です。');
    return value;
  };
  const list = (value, maxItems = 100) => {
    if (!Array.isArray(value) || value.length > maxItems) throw Error('教材データの配列が不正です。');
    return value.map(item => text(item));
  };
  function validate(value) {
    if (!value || !Array.isArray(value.words) || value.words.length !== 337) throw Error('337件の教材JSONを選んでください。');
    return value.words.map((w, index) => {
      if (!w || typeof w !== 'object' || w.id !== index + 1) throw Error('単語番号が1から337まで順番に並んでいません。');
      const word = text(w.word, 1000), meanings = list(w.meanings), examples = w.examples;
      if (!word.trim() || !meanings.length || meanings.some(m => !m.trim())) throw Error(`No.${w.id} の単語または意味が空です。`);
      if (!Array.isArray(examples) || examples.length > 100) throw Error(`No.${w.id} の例文が不正です。`);
      return {id:w.id, word, meanings, variants:list(w.variants), kanji:list(w.kanji), pos:list(w.pos), pages:list(w.pages), examples:examples.map(e => {
        if (!e || typeof e !== 'object' || Array.isArray(e)) throw Error('例文の形式が不正です。');
        return {sentence:text(e.sentence), translation:text(e.translation), source:text(e.source), gloss:text(e.gloss)};
      })};
    });
  }
  function open() {
    return new Promise((resolve,reject) => {
      if (!root.indexedDB) return reject(Error('このブラウザーでは教材を保存できません。'));
      const request=root.indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || Error('教材を開けませんでした。'));
      request.onblocked=()=>reject(Error('別のタブが教材を使用中です。'));
    });
  }
  async function load() {
    const db=await open();
    try { return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'), req=tx.objectStore(STORE).get('main');
      req.onsuccess=()=>resolve(req.result ?? null); req.onerror=()=>reject(req.error);
    }); } finally { db.close(); }
  }
  async function importOnce(value) {
    const words=validate(value), db=await open();
    try { await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).add({words},'main');
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error || Error('教材を保存できませんでした。'));
      tx.onerror=()=>{};
    }); } finally { db.close(); }
  }
  const api={validate,load,importOnce};
  if (typeof module !== 'undefined' && module.exports) module.exports=api; else root.KotonohaData=api;
})(typeof window === 'undefined' ? globalThis : window);
