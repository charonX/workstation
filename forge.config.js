import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const config = {
  packagerConfig: {
    asar: true
  },
  rebuildConfig: {
    force: true
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {}
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO"
      }
    }
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.js",
          config: "vite.main.config.js"
        },
        {
          entry: "src/preload/preload.js",
          config: "vite.preload.config.js"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.js"
        }
      ]
    })
  ]
};

export default config;
