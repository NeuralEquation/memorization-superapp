const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('./engine.js');
const D = require('./data-store.js');
// Synthetic data only: real user-provided content is never part of the repo.
const words=Array.from({length:337},(_,i)=>({id:i+1,word:`検証語${i+1}`,meanings:[`意味${i+1}`],variants:[],kanji:[],pos:[],pages:[],examples:[]}));
assert.equal(words.length,337);
assert.deepEqual(words.map(w=>w.id),Array.from({length:337},(_,i)=>i+1));
assert.equal(D.validate({words}).length,337);
assert.throws(()=>D.validate({words:words.slice(1)}));
assert.throws(()=>D.validate({words:words.map((w,i)=>i===0?{...w,word:''}:w)}));
assert.throws(()=>D.validate({words:words.map((w,i)=>i===0?{...w,id:2}:w)}));
for (const w of words) {
  const choices = E.choicesFor(w,words,()=>0.5);
  assert.ok(choices && choices.length===4, `choices for ${w.id}`);
  assert.equal(choices.filter(c=>c.id===w.id).length,1);
  assert.equal(new Set(choices.map(c=>c.label)).size,4);
}
const overlap = [{id:1,meanings:['同じ']},{id:2,meanings:['同じ']},{id:3,meanings:['別']},{id:4,meanings:['別二']},{id:5,meanings:['別三']}];
assert.ok(!E.choicesFor(overlap[0],overlap,()=>0.3).some(x=>x.id===2));
assert.equal(E.choicesFor(overlap[0],overlap.slice(0,4)),null);
assert.deepEqual(E.filterWords(words,1,10,true,{'3':{star:true},'12':{star:true}}).map(w=>w.id),[3]);
const p={format:'kotonoha-337',version:1,progress:{'1':{star:true,rating:'known',attempts:2,correct:1}}};
assert.deepEqual(E.validateBackup(p,words.map(w=>w.id)),p.progress);
assert.throws(()=>E.validateBackup({...p,version:2},words.map(w=>w.id)));
assert.throws(()=>E.validateBackup({...p,progress:{'1':{star:true,rating:'known',attempts:0,correct:1}}},words.map(w=>w.id)));
assert.throws(()=>E.validateBackup({...p,progress:{'338':{star:false,rating:'',attempts:0,correct:0}}},words.map(w=>w.id)));
for(const name of ['index.html','style.css','engine.js','data-store.js','app.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png']) assert.ok(fs.existsSync(__dirname+'/'+name),name);
assert.ok(!fs.existsSync(__dirname+'/words.json'),'User content must not be included in the repository');
console.log('Synthetic import, 337 choices, filtering, and backup validation: OK');
