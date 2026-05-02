/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // ── Legacy palette (kept intact — existing screens depend on these) ──
        // Direction 2 — Blue Sky Afternoon: sky/teal is the primary colour;
        // coral is reserved for action/alert, stars, and destructive states only.
        coral:       { DEFAULT: "#FF6B6B", light: "#FF8E8E", dark: "#E05555" },
        sky:         { DEFAULT: "#4ECDC4", light: "#72D9D2", dark: "#3AB5AC" }, // PRIMARY
        sun:         { DEFAULT: "#FFE66D", light: "#FFED94", dark: "#E6CE55" },
        mint:        { DEFAULT: "#7DD4C4", light: "#A0DDD6", dark: "#5BBFB4" },
        // Neutral (legacy)
        slate:       { DEFAULT: "#F0F7F7", dark: "#E0F0EF" },
        sand:        { DEFAULT: "#FFF9F0", dark: "#F5EDE0" },
        sandDark:    "#F5EDE0",
        charcoal:    { DEFAULT: "#2D3436", light: "#636E72" },
        grey:        { DEFAULT: "#636E72", light: "#B2BEC3", lighter: "#DFE6E9" },
        greyLighter: "#DFE6E9",
        // Semantic (legacy)
        success:     "#00B894",
        error:       "#D63031",

        // ── Phase 1 redesign tokens (PP palette from tokens.jsx) ──
        // These are ADDITIVE — existing screens are unaffected.
        // New components use the "pp-" prefix to avoid colliding with the
        // legacy "sky"/"coral"/"sand" keys above which have different hex values.
        "pp-sky":    { DEFAULT: "#2FB8B0", deep: "#1B8A85", soft: "#D4F0EE", wash: "#EEF9F8" },
        "pp-coral":  { DEFAULT: "#FF6B6B", soft: "#FFE2DE" },
        "pp-sun":    { DEFAULT: "#FFD66B", soft: "#FFF1C7" },
        "pp-plum":   { DEFAULT: "#8E6BD8", soft: "#ECE1FF" },
        "pp-leaf":   { DEFAULT: "#5BC08A", soft: "#DCF4E4" },
        "pp-ink":    { DEFAULT: "#1D2630", soft: "#4A5560" },
        "pp-mute":   "#7B8794",
        "pp-line":   { DEFAULT: "#E6E2DB", soft: "#F1ECE2" },
        "pp-sand":   { DEFAULT: "#FBF6EC", deep: "#F2EBDD" },
        "pp-paper":  "#FFFFFF",
        "pp-cream":  "#FFFBF3",
        "pp-star":   "#F5A524",
      },
      borderRadius: {
        // Phase 1 radius scale — matches RADIUS_BASE in tokens.jsx.
        // Named "r-xs" etc. to avoid colliding with Tailwind's built-in
        // "rounded-sm", "rounded-md" etc.
        "r-xs": "8px",
        "r-sm": "12px",
        "r-md": "18px",
        "r-lg": "24px",
        "r-xl": "32px",
      },
      fontFamily: {
        sans:      ["Nunito-Regular"],
        medium:    ["Nunito-Medium"],
        bold:      ["Nunito-Bold"],
        extrabold: ["Nunito-ExtraBold"],
      },
    },
  },
  plugins: [],
};
