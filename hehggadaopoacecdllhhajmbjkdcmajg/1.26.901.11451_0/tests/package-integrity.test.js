"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = rel => fs.existsSync(path.join(ROOT, rel));

function pass(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}
function localRef(htmlRel, ref) {
  if (/^(https?:|data:|#)/.test(ref)) return null;
  if (ref.startsWith("/")) return ref.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(htmlRel), ref));
}
function refsFromHtml(rel) {
  return [...read(rel).matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]);
}
function assertHtmlReferences(rel) {
  for (const ref of refsFromHtml(rel)) {
    const target = localRef(rel, ref);
    if (!target) continue;
    assert.ok(exists(target), rel + " missing referenced asset " + ref + " -> " + target);
  }
}

const manifest = JSON.parse(read("manifest.json"));
const buildInfo = JSON.parse(read("codex/build-info.json"));
const background = read("background.js");

pass("canonical Developer Workforce manifest identity", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Developer Workforce Extension");
  assert.match(manifest.version, /^4\.\d+\.\d+(?:\.\d+)?$/);
  assert.match(manifest.description, /15-agent Titan developer workforce/i);
});

pass("stock build provenance remains explicit", () => {
  assert.equal(buildInfo.build_flavor, "release");
  assert.equal(buildInfo.release_channel, "stable");
  assert.match(buildInfo.sha, /^[0-9a-f]{40}$/);
});

pass("manifest required files exist", () => {
  const required = new Set();
  if (manifest.background?.service_worker) required.add(manifest.background.service_worker);
  if (manifest.side_panel?.default_path) required.add(manifest.side_panel.default_path);
  for (const entry of manifest.content_scripts || []) {
    for (const rel of entry.js || []) required.add(rel);
    for (const rel of entry.css || []) required.add(rel);
  }
  for (const rel of Object.values(manifest.icons || {})) required.add(rel);
  for (const group of manifest.web_accessible_resources || []) {
    for (const rel of group.resources || []) {
      if (!rel.includes("*")) required.add(rel);
    }
  }
  assert.ok(required.size > 0);
  for (const rel of required) assert.ok(exists(rel), "manifest reference missing: " + rel);
});

pass("HTML bootstrap references all resolve", () => {
  for (const rel of ["codex-sidepanel/index.html", "codex-work-sidepanel.html", "microphone-permission.html"]) {
    assertHtmlReferences(rel);
  }
});

pass("required dynamic runtime entrypoints exist", () => {
  const dynamic = [
    "content-scripts/codex.js",
    "content-scripts/foreign-frame-monitor.js",
    "codex-work-sidepanel.html"
  ];
  for (const rel of dynamic) {
    assert.ok(background.includes(rel), "background lost dynamic reference: " + rel);
    assert.ok(exists(rel), "dynamic entrypoint missing: " + rel);
  }
});

pass("upstream dormant WebMCP references stay explicitly bounded", () => {
  const dormant = [
    "content-scripts/webmcp.js",
    "content-scripts/webmcp-bridge.js"
  ];
  for (const rel of dormant) {
    assert.ok(background.includes(rel), "upstream WebMCP reference changed; review allowlist: " + rel);
    // This OpenAI stable build intentionally does not ship these gated files.
    // If they appear later, this check still passes and the packaging policy
    // should be revisited to promote them to required runtime entrypoints.
  }
});

pass("browser-family icon metadata absence is a known bounded upstream condition", () => {
  const sources = [
    read("background.js"),
    read("content-scripts/codex.js"),
    read("content-scripts/chatgpt-website.js")
  ].join("\n");
  const paths = [...new Set([...sources.matchAll(/browserIconAssetPath:["']([^"']+)["']/g)].map(m => m[1]))];
  const allowed = new Set([
    "assets/google-chrome.png",
    "assets/microsoft-edge.svg",
    "assets/brave.svg",
    "assets/opera.svg",
    "assets/vivaldi.svg"
  ]);
  assert.deepEqual(new Set(paths), allowed);
});

pass("stale Chrome Web Store computed hashes are absent", () => {
  assert.equal(exists("_metadata/computed_hashes.json"), false);
});

pass("unpacked developer deployment policy is explicit", () => {
  const doc = read("TITAN-INSTALL-PREFLIGHT.md");
  assert.match(doc, /unpacked developer extension/i);
  assert.match(doc, /stock extension key/i);
  assert.match(doc, /update_url/i);
  assert.match(doc, /native messaging/i);
});

pass("package workflow derives artifact version from manifest", () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/package-extension.yml"), "utf8");
  assert.match(workflow, /manifest\.json/);
  assert.match(workflow, /VERSION=/);
  assert.match(workflow, /Developer-Workforce-Extension-v\$\{VERSION\}\.zip/);
  assert.doesNotMatch(workflow, /Developer-Workforce-Extension-v4\.0\.0\.zip/);
});

console.log("\nPackage integrity checks passed for " + manifest.name + " v" + manifest.version + ".");
