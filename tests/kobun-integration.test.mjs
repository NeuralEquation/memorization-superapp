import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const read = name => readFile(new URL(`../${name}`,import.meta.url),'utf8');
const scope='https://example.test/foundry/';

test('Foundry activation deletes only old caches belonging to the same installation',async()=>{
  const events={},deleted=[];
  const names=['memory-foundry-shell-old','memory-foundry-shell-other','memory-foundry-shell-v1.6.2-kobun-1','kotonoha-337-v3:'+scope+'kobun/','unrelated'];
  const caches={keys:async()=>names,delete:async key=>deleted.push(key),open:async key=>({match:async url=>key==='memory-foundry-shell-old'&&url===scope+'index.html'?{}:undefined})};
  const self={registration:{scope},clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(await read('sw.js'),{URL,Response,self,caches});
  let done;events.activate({waitUntil(p){done=p;}});await done;
  assert.deepEqual(deleted,['memory-foundry-shell-old']);
});

test('child SW activation preserves Foundry, unrelated apps and other scopes',async()=>{
  const events={},deleted=[],child=scope+'kobun/';
  const names=['kotonoha-337-old','kotonoha-337-other','kotonoha-337-v3:'+child,'memory-foundry-shell-v1.6.2-kobun-1','unrelated'];
  const caches={keys:async()=>names,delete:async key=>deleted.push(key),open:async key=>({match:async url=>key==='kotonoha-337-old'&&url===child+'index.html'?{}:undefined})};
  const self={registration:{scope:child},clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(await read('kobun/sw.js'),{URL,self,caches});
  let done;events.activate({waitUntil(p){done=p;}});await done;
  assert.deepEqual(deleted,['kotonoha-337-old']);
});

test('the shell is available offline without embedding private word data',async()=>{
  const [app,sw,child,childSW]=await Promise.all(['src/app.js','sw.js','kobun/index.html','kobun/sw.js'].map(read));
  assert.match(app,/href="\.\/kobun\/"/);
  assert.match(child,/href="\.\.\/"/);
  for(const name of ['kobun/','kobun/app.js','kobun/data-store.js','kobun/engine.js']) assert.ok(sw.includes(name));
  assert.doesNotMatch(sw,/kobun\/words\.json/);
  assert.doesNotMatch(childSW,/words\.json/);
  const require=createRequire(import.meta.url);require('../kobun/test.js');
});
