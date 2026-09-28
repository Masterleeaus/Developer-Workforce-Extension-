"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function file(rel) {
  return path.join(ROOT, rel);
}
function read(rel) {
  return fs.readFileSync(file(rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(file(rel));
}
function ok(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}
function assertContains(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), label + " missing contract token: " + token);
  }
}
function resolveHtmlRef(htmlRel, ref) {
  if (/^(https?:|data:|#)/.test(ref)) return null;
  if (ref.startsWith("/")) return ref.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(htmlRel), ref));
}
function htmlRefs(htmlRel) {
  const html = read(htmlRel);
  return [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
}
function assertHtmlRefsExist(htmlRel) {
  for (const ref of htmlRefs(htmlRel)) {
    const resolved = resolveHtmlRef(htmlRel, ref);
    if (!resolved) continue;
    assert.ok(exists(resolved), htmlRel + " references missing asset " + ref + " -> " + resolved);
  }
}

const manifest = JSON.parse(read("manifest.json"));
const background = read("background.js");
const chatgpt = read("content-scripts/chatgpt-website.js");
const codex = read("content-scripts/codex.js");
const media = read("content-scripts/codex-work-media-permission.js");
const workPanel = read("chunks/codex-work-sidepanel-0JzHpPDf.js");
const permissionChunk = read("chunks/microphone-permission-C1jIdemt.js");
const sidePanelHtml = read("codex-sidepanel/index.html");
const nativeAdapters = read("codex-sidepanel/titan-stock-native-adapters.js");
const preflight = read("codex-sidepanel/titan-preflight.js");

ok("manifest is MV3 and all declared entrypoints exist", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background && manifest.background.service_worker);
  assert.ok(exists(manifest.background.service_worker), "background service worker missing");
  assert.ok(manifest.side_panel && manifest.side_panel.default_path);
  assert.ok(exists(manifest.side_panel.default_path), "side-panel entrypoint missing");
  for (const entry of manifest.content_scripts || []) {
    for (const script of entry.js || []) {
      assert.ok(exists(script), "manifest content script missing: " + script);
    }
  }
});

ok("required Chrome runtime permissions remain declared", () => {
  const permissions = new Set(manifest.permissions || []);
  for (const required of ["tabs", "scripting", "storage", "sidePanel", "nativeMessaging", "debugger"]) {
    assert.ok(permissions.has(required), "missing manifest permission: " + required);
  }
});

ok("HTML bootstrap assets resolve", () => {
  assertHtmlRefsExist("codex-sidepanel/index.html");
  assertHtmlRefsExist("codex-work-sidepanel.html");
  assertHtmlRefsExist("microphone-permission.html");
});

ok("background owns the stable runtime message contracts", () => {
  assertContains(background, [
    "GET_CHATGPT_EXTENSION_STATUS",
    "OPEN_CODEX_SIDE_PANEL",
    "SHOW_CODEX_INSTALLER",
    "CODEX_WORK_SIDE_PANEL_AUTH_OPEN",
    "CODEX_WORK_SIDE_PANEL_AUTH_STATE",
    "CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE"
  ], "background");
});

ok("background dynamic runtime entrypoints exist", () => {
  const requiredDynamic = [
    "content-scripts/codex.js",
    "content-scripts/foreign-frame-monitor.js",
    "codex-work-sidepanel.html"
  ];
  for (const rel of requiredDynamic) {
    assert.ok(background.includes(rel), "background no longer references " + rel);
    assert.ok(exists(rel), "dynamic runtime file missing: " + rel);
  }
  // OpenAI's current stable build contains dormant WebMCP registration paths
  // without shipping the gated content scripts. They are intentionally not
  // treated as required package entrypoints here.
});

ok("ChatGPT website bridge sends the expected requests", () => {
  assertContains(chatgpt, [
    "chrome.runtime.sendMessage",
    "GET_CHATGPT_EXTENSION_STATUS",
    "GET_CHATGPT_BROWSER_TAB_CONTEXT",
    "SHOW_CODEX_INSTALLER",
    "OPEN_CODEX_SIDE_PANEL",
    "chatgpt-extension-request-action",
    "chatgpt-extension-request-browser-tab-context"
  ], "ChatGPT content script");
});

ok("Codex content script keeps agent cursor runtime handshake", () => {
  assertContains(codex, [
    "chrome.runtime.sendMessage",
    "GET_AGENT_CURSOR_STATE",
    "AGENT_CURSOR_STATE",
    "AGENT_CURSOR_ARRIVED"
  ], "Codex content script");
});

ok("Work sidepanel keeps iframe, auth, context and storage handshakes", () => {
  assertContains(workPanel, [
    "work-sidepanel-frame-container",
    "CODEX_WORK_SIDE_PANEL_AUTH_OPEN",
    "CODEX_WORK_SIDE_PANEL_AUTH_STATE",
    "CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE",
    "browser_side_chat",
    "chrome.runtime.sendMessage",
    "postMessage",
    "chrome.storage.local",
    "storage?.session",
    "microphone-permission.html"
  ], "Work sidepanel");
});

ok("media permission bridge and permission page are connected", () => {
  assertContains(media, [
    "getUserMedia",
    "navigator.permissions",
    "microphone",
    "camera"
  ], "media bridge");
  assertContains(permissionChunk, [
    "getUserMedia",
    "allow-microphone",
    "permission-help",
    "status"
  ], "permission page");
});

ok("restart, update and native-host status contracts remain in service worker", () => {
  assertContains(background, [
    "chrome.runtime.onStartup",
    "chrome.runtime.onUpdateAvailable",
    "codexPendingUpdateVersion",
    "extensionInstanceId",
    "chrome.storage.session",
    "nativeHostStatus",
    "ensure_codex_app_server",
    "report_codex_app_server_connection_failure"
  ], "background lifecycle");
});

ok("stock native adapter and expanded preflight are bootstrapped", () => {
  assertContains(sidePanelHtml, [
    "titan-stock-native-adapters.js",
    "titan-preflight.js"
  ], "sidepanel HTML");
  assertContains(nativeAdapters, [
    "installTitanStockAdapters",
    "titan:stock-native-service",
    "github",
    "repository",
    "runtime"
  ], "native adapter");
  assertContains(preflight, [
    "Developer Workforce v4",
    "15-agent topology",
    "Codex service",
    "Git service",
    "GitHub service",
    "Repository service",
    "Runtime Verification"
  ], "preflight");
});

ok("important failure paths remain explicit rather than false-success", () => {
  assertContains(background, [
    "Browser tab context is unavailable",
    "Unable to read Chrome tab context",
    "native_host_unreachable",
    "no_compatible_app_server",
    "app_server_runtime_error"
  ], "background failure path");
  assertContains(workPanel, [
    "Work side panel root not found"
  ], "Work sidepanel failure path");
});

console.log("\nExtension runtime smoke tests passed.");
