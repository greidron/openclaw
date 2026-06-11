import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";
import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk/plugin-runtime";

export type NaverWorksPluginRuntime = PluginRuntime & { log?: RuntimeLogger };

const { setRuntime: setNaverWorksRuntime, getRuntime: getNaverWorksRuntime } =
  createPluginRuntimeStore<NaverWorksPluginRuntime>("NAVER WORKS runtime not initialized");

export { getNaverWorksRuntime, setNaverWorksRuntime };
