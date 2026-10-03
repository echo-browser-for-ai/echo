import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		port: 5173,
		strictPort: true,
	},
	plugins: [
		react(),
		electron({
			main: {
				// Shortcut of `build.lib.entry`.
				entry: "electron/main.ts",
				vite: {
					build: {
						rollupOptions: {
							// electron-updater is CommonJS and calls `require("fs")` at module
							// load. Bundling it into our ESM main (package.json type:module)
							// breaks because `require` doesn't exist in ESM. Keep it EXTERNAL so
							// it loads from node_modules at runtime — in dev from the project's
							// node_modules, in prod from the asar's node_modules (electron-builder
							// already packs it + its deps). There it runs in its native CJS form,
							// where `require` works fine.
							//
							// Vite 8 ships Rolldown as the default bundler, and its ESM wrapper
							// doesn't expose `require` for CJS interop the way Rollup did. Any
							// dependency (or transitively-required Node built-in) that calls
							// `require("fs")` / `require("path")` etc. at module scope will throw.
							// Node built-ins should NEVER be bundled — they're native to the
							// Electron runtime and must load from there.
							external: [
								"electron-updater",
								// All Node.js built-ins — keep them out of the ESM bundle
								"node:fs",
								"fs",
								"node:path",
								"path",
								"node:crypto",
								"crypto",
								"node:stream",
								"stream",
								"node:child_process",
								"child_process",
								"node:url",
								"url",
								"node:os",
								"os",
								"node:http",
								"http",
								"node:https",
								"https",
								"node:net",
								"net",
								"node:tls",
								"tls",
								"node:dns",
								"dns",
								"node:events",
								"events",
								"node:buffer",
								"buffer",
								"node:util",
								"util",
								"node:assert",
								"assert",
							],
						},
					},
				},
			},
			preload: {
				// Shortcut of `build.rollupOptions.input`.
				// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
				input: path.join(__dirname, "electron/preload.ts"),
				vite: {
					build: {
						rollupOptions: {
							output: {
								codeSplitting: false,
							},
						},
					},
				},
			},
			// Ployfill the Electron and Node.js API for Renderer process.
			// If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
			// See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
			renderer:
				process.env.NODE_ENV === "test"
					? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
						undefined
					: { codeSplitting: false },
		}),
	],
});
