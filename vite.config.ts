// EasyWork - Vite 构建配置
// 启用 React 插件、固定开发端口 1420（Tauri 对接）、平台适配。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // Tauri expects a fixed port in dev
  server: {
    port: 1421,
    strictPort: false,
  },

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Tauri uses env variables for development
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
