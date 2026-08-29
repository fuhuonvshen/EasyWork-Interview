// EasyWork - Tailwind CSS 配置
// 自定义 accent 色系（蓝紫色）、中文字体栈。
// 扫描 src/ 下所有 TSX/JSX 文件中的 class 名。

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#f0f2ff",
          100: "#dbe0ff",
          200: "#bcc5ff",
          300: "#8c9aff",
          400: "#5c6bff",
          500: "#3b4bff",
          600: "#2a36e0",
          700: "#1e28b8",
          800: "#182296",
          900: "#141d7a",
          950: "#0c1047",
        },
        // 会议纪要主色调（Indigo 官方色板），换配色只改这里
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
