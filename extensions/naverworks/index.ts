import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "naverworks",
  name: "NAVER WORKS",
  description: "NAVER WORKS channel plugin for OpenClaw",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./src/channel.js",
    exportName: "naverWorksPlugin",
  },
  runtime: {
    specifier: "./src/runtime.js",
    exportName: "setNaverWorksRuntime",
  },
});
