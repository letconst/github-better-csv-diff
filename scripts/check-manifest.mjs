import { readFileSync } from "node:fs";

const GITHUB = "https://github.com/*";
const RAW = "https://raw.githubusercontent.com/*";
const failures = [];

function check(label, ok) {
  if (!ok) failures.push(label);
}

function load(dir) {
  return JSON.parse(readFileSync(`dist/${dir}/manifest.json`, "utf8"));
}

function checkContentScript(name, manifest) {
  const script = (manifest.content_scripts ?? []).find((s) =>
    s.matches?.includes(GITHUB),
  );
  check(`${name}: content script matching ${GITHUB}`, script !== undefined);
  check(`${name}: content script lists a css entry`, !!script?.css?.length);
}

const chrome = load("chrome-mv3");
checkContentScript("chrome", chrome);
check("chrome: no host_permissions", chrome.host_permissions === undefined);
check(
  "chrome: no host patterns in permissions",
  !(chrome.permissions ?? []).some(
    (p) => p.includes("://") || p === "<all_urls>",
  ),
);

const firefox = load("firefox-mv2");
checkContentScript("firefox", firefox);
const firefoxHosts =
  firefox.manifest_version === 3
    ? (firefox.host_permissions ?? [])
    : (firefox.permissions ?? []);
check(`firefox: host permission ${GITHUB}`, firefoxHosts.includes(GITHUB));
check(`firefox: host permission ${RAW}`, firefoxHosts.includes(RAW));

if (failures.length > 0) {
  console.error(`Manifest check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Manifest check passed");
