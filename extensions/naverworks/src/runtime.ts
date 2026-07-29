import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setNaverWorksRuntime, getRuntime: getNaverWorksRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "naverworks",
    errorMessage: "NAVER WORKS runtime not initialized",
  });

export { getNaverWorksRuntime, setNaverWorksRuntime };
