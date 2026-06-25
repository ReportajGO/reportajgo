import type { Config } from "tailwindcss";

/**
 * ReportajGO brand configuration.
 * Palette and typography are driven straight from the brandbook.
 */
const config: Config = {
  darkMode: "class", // toggled by next-themes (Шаг 2)
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // Impulsive signal red — accents, "GO", BREAKING, hovers.
          red: "#E51A24",
          "red-hot": "#FF1E27",
          "red-ink": "#B3121A",
          // Deep matte black — dark-theme bg / light-theme text.
          black: "#0A0D15",
          "black-soft": "#10141E",
          // Clean white — light-theme bg / dark-theme text.
          white: "#FFFFFF",
        },
        // Semantic tokens resolved via CSS variables (set per theme in globals.css).
        bg: "rgb(var(--bg) / <alpha-value>)",
        "bg-sub": "rgb(var(--bg-sub) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        line: "rgb(var(--border) / <alpha-value>)",
        ink: "rgb(var(--text) / <alpha-value>)",
        "ink-soft": "rgb(var(--text-soft) / <alpha-value>)",
      },
      fontFamily: {
        // Bound to next/font variables in layout (Шаг 2/3).
        display: ["var(--font-archivo)", "system-ui", "sans-serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
        mono: ["var(--font-space-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        page: "1180px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,20,30,.06), 0 8px 24px rgba(16,20,30,.06)",
        "card-dark": "0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.45)",
      },
      keyframes: {
        pulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(229,26,36,.6)" },
          "70%": { boxShadow: "0 0 0 7px rgba(229,26,36,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(229,26,36,0)" },
        },
        ticker: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        pulse: "pulse 1.6s infinite",
        ticker: "ticker 38s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
