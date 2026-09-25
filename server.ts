// V2 local-plugin entrypoint. When V2 loads this repo as a plugin directory,
// Host.resolve tries "<dir>/server" before "<dir>/index", so this file is the
// first entry it finds. The default export is the dual-shape module that also
// satisfies V1 (V1 calls `server()` and ignores `setup`).
export { default } from "./src/index.js"
export { ModelDiscoveryPlugin, setupV2 } from "./src/index.js"
