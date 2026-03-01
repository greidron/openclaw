import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtimeRef: PluginRuntime | null = null;

export function setNaverWorksRuntime(runtime: PluginRuntime) {
  runtimeRef = runtime;
}

export function getNaverWorksRuntime(): PluginRuntime {
  if (!runtimeRef) {
    throw new Error("NAVER WORKS runtime is not initialized");
  }
  return runtimeRef;
}
