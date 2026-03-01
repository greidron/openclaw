import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createNaverWorksPlugin } from "./src/channel.js";
import { setNaverWorksRuntime } from "./src/runtime.js";

const plugin = {
  id: "naverworks",
  name: "NAVER WORKS",
  description: "NAVER WORKS channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setNaverWorksRuntime(api.runtime);
    api.registerChannel({ plugin: createNaverWorksPlugin() });
  },
};

export default plugin;
