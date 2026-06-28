/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // CodeBattlefield Theme Colors
        dark: "#0f172a",
        primary: "#3b82f6",
        secondary: "#1e293b",
      }
    },
  },
  plugins: [],
}