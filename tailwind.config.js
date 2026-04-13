/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Primary brand palette
        // Direction 2 — Blue Sky Afternoon: sky/teal is the primary colour;
        // coral is reserved for action/alert, stars, and destructive states only.
        coral:       { DEFAULT: "#FF6B6B", light: "#FF8E8E", dark: "#E05555" },
        sky:         { DEFAULT: "#4ECDC4", light: "#72D9D2", dark: "#3AB5AC" }, // PRIMARY
        sun:         { DEFAULT: "#FFE66D", light: "#FFED94", dark: "#E6CE55" },
        mint:        { DEFAULT: "#7DD4C4", light: "#A0DDD6", dark: "#5BBFB4" }, // updated: more saturated, closer to teal family
        // Neutral
        slate:       { DEFAULT: "#F0F7F7", dark: "#E0F0EF" }, // page background (replaces sand as root bg)
        sand:        { DEFAULT: "#FFF9F0", dark: "#F5EDE0" }, // kept for cards / inner containers
        sandDark:    "#F5EDE0",   // flat alias — screens use bg-sandDark not bg-sand-dark
        charcoal:    { DEFAULT: "#2D3436", light: "#636E72" },
        grey:        { DEFAULT: "#636E72", light: "#B2BEC3", lighter: "#DFE6E9" },
        greyLighter: "#DFE6E9",
        // Semantic
        error:       "#D63031",   // destructive actions, "Closed" labels
      },
      fontFamily: {
        sans:    ["Nunito-Regular"],
        medium:  ["Nunito-Medium"],
        bold:    ["Nunito-Bold"],
        extrabold:["Nunito-ExtraBold"],
      },
    },
  },
  plugins: [],
};
