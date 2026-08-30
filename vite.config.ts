// EasyWork - Vite 构建配置
// 启用 React 插件、固定开发端口 1420（Tauri 对接）、平台适配。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    // pdf.js 中文 CID 字体解码需要 cMap 表；Tesseract OCR 的 worker/core 需本地化（离线可用）
    viteStaticCopy({
      targets: [
        { src: "node_modules/pdfjs-dist/cmaps/*", dest: "cmaps" },
        { src: "node_modules/tesseract.js/dist/worker.min.js", dest: "tesseract" },
        { src: "node_modules/tesseract.js-core/tesseract-core*.js", dest: "tesseract" },
        { src: "node_modules/tesseract.js-core/tesseract-core*.wasm", dest: "tesseract" },
      ],
    }),
  ],

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
