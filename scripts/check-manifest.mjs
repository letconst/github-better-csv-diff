import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const GITHUB = "https://github.com/*";
const RAW = "https://raw.githubusercontent.com/*";

function load(dir) {
  return JSON.parse(readFileSync(`dist/${dir}/manifest.json`, "utf8"));
}

function assertContentScript(name, manifest) {
  const script = manifest.content_scripts?.find((s) =>
    s.matches?.includes(GITHUB),
  );
  assert.ok(script, `${name}: content script matching ${GITHUB}`);
  assert.ok(script.css?.length, `${name}: content script lists a css entry`);
}

const chrome = load("chrome-mv3");
assertContentScript("chrome", chrome);
assert.equal(chrome.host_permissions, undefined, "chrome: no host_permissions");
assert.ok(
  !chrome.permissions?.some((p) => p.includes("://") || p === "<all_urls>"),
  "chrome: no host patterns in permissions",
);

const firefox = load("firefox-mv2");
assertContentScript("firefox", firefox);
for (const host of [GITHUB, RAW]) {
  assert.ok(
    firefox.permissions?.includes(host),
    `firefox: host permission ${host}`,
  );
}

console.log("Manifest check passed");
