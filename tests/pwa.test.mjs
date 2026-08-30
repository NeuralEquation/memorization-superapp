import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP_VERSION } from "../src/core.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PWA shell and every module edge use one release version", async () => {
  const [html, sw, app, core, storage, registry] = await Promise.all([
    read("index.html"), read("sw.js"), read("src/app.js"), read("src/core.js"), read("src/storage.js"), read("src/exercise-registry.js")
  ]);
  assert.match(html, new RegExp(`src/app\\.js\\?v=${APP_VERSION}`));
  assert.match(html, new RegExp(`styles\\.css\\?v=${APP_VERSION}`));
  assert.match(sw, new RegExp(`memory-foundry-shell-v${APP_VERSION.replaceAll(".", "\\.")}`));
  for (const asset of ["app.js", "core.js", "storage.js", "exercise-types.js", "exercise-registry.js", "library.js", "constitution-mock.js", "builtin-packs.json"]) {
    assert.match(sw, new RegExp(`${asset.replace(".", "\\.")}\\?v=${APP_VERSION.replaceAll(".", "\\.")}`));
  }
  for (const source of [app, core, storage, registry]) {
    for (const match of source.matchAll(/from\s+"(\.\/[^"?]+\.js)([^"]*)"/g)) {
      assert.equal(match[2], `?v=${APP_VERSION}`, `${match[1]} must be versioned`);
    }
  }
});

test("rating persistence has a synchronous double-submit guard", async () => {
  const app = await read("src/app.js");
  assert.match(app, /if \(!session \|\| session\.saving\) return;/);
  assert.match(app, /activeSession\.saving = true;/);
  assert.match(app, /button\.disabled = true;/);
  assert.match(app, /start-constitution-mock/);
  assert.match(app, /sessionStorage/);
  assert.match(app, /compositionstart/);
  assert.match(app, /compositionend/);
  assert.match(app, /favorite-star/);
  assert.match(app, /library-open-all/);
  assert.match(app, /library-close-all/);
  assert.match(app, /start-library-entry/);
  assert.match(app, /start-library-from/);
  assert.match(app, /openLibraryEntryIds/);
});

test("mobile shell prevents study actions and Japanese copy from fragmenting", async () => {
  const styles = await read("styles.css");
  assert.match(styles, /word-break:\s*auto-phrase/);
  assert.match(styles, /\.pack-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /\.pack-actions button[^}]*white-space:\s*nowrap/);
});
