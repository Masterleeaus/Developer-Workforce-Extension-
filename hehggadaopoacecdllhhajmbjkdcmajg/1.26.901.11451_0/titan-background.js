import "./background.js";

(async()=>{
  await import("./titan-workforce/chat-five-pass-scheduler.js");
  await import("./titan-workforce/chat-five-pass-integration.js");
  await import("./codex-sidepanel/titan-agent-profiles.js");
  await import("./titan-work-codex-pipeline.js");
  await import("./codex-sidepanel/titan-workforce/background-runtime.js");
})().catch(error=>{
  console.error("[Titan Workforce] service worker module loader failed",error);
});
