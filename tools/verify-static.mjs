import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "src/app.js",
  "src/core.js",
  "src/storage.js",
  "src/exercise-types.js",
  "src/exercise-registry.js",
  "data/builtin-packs.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

for (const file of requiredFiles) {
  await access(path.join(root, file), constants.R_OK);
}

const [html, manifestText, serviceWorker, bundleText] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "manifest.webmanifest"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "data/builtin-packs.json"), "utf8"),
]);

const manifest = JSON.parse(manifestText);
const bundle = JSON.parse(bundleText);

const assertions = [
  [html.includes('type="module"') && html.includes("./src/app.js"), "index.html must load the ES module app"],
  [html.includes("manifest.webmanifest"), "index.html must link the manifest"],
  [manifest.start_url === "./", "manifest start_url must stay checkout-relative"],
  [manifest.display === "standalone", "manifest must request standalone display"],
  [Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest must include install icons"],
  [serviceWorker.includes("memory-foundry-shell-v1.0.1"), "service worker cache version is missing"],
  [serviceWorker.includes("data/builtin-packs.json"), "service worker must cache built-in data"],
  [bundle.schemaVersion === 1, "built-in bundle schemaVersion must be 1"],
  [Array.isArray(bundle.packs) && bundle.packs.length === 3, "built-in bundle must contain three packs"],
];

for (const [condition, message] of assertions) {
  if (!condition) throw new Error(message);
}

console.log(`Static verification passed: ${requiredFiles.length} files, ${bundle.packs.length} packs.`);

