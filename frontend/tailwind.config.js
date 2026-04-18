/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'IBM Plex Mono'", "monospace"],
        sans: ["'IBM Plex Sans'", "sans-serif"],
      },
      colors: {
        bg: "#07080a",
        surface: "#0f1117",
        border: "#1e2130",
        accent: "#00e5b4",
        warn: "#f0a500",
        bear: "#ff4d6d",
        bull: "#00e5b4",
        neutral: "#7a8098",
        muted: "#3a3f55",
      },
    },
  },
  plugins: [],
};
