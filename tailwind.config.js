/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // 深色金融背景
        base: {
          900: "#0a0e14", // 最深背景
          800: "#0d1117", // 主背景
          700: "#161b22", // 卡片背景
          600: "#1c2330", // hover 背景
          500: "#242d3d", // 边框/分隔
        },
        // 中国股市红涨绿跌
        rise: {
          DEFAULT: "#ef4444",
          bright: "#ff4d4f",
          deep: "#c8242c",
        },
        fall: {
          DEFAULT: "#10b981",
          bright: "#22c55e",
          deep: "#06d6a0",
        },
        accent: {
          gold: "#ffd60a",
          amber: "#f59e0b",
        },
        text: {
          primary: "#e6edf3",
          secondary: "#8b949e",
          muted: "#6e7681",
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', "Menlo", "monospace"],
        sans: ['"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 12px rgba(255, 214, 10, 0.25)",
        "glow-red": "0 0 12px rgba(239, 68, 68, 0.35)",
        "glow-green": "0 0 12px rgba(16, 185, 129, 0.35)",
        panel: "0 4px 24px rgba(0, 0, 0, 0.4)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
