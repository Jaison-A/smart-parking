/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12181B",
        paper: "#F6F5F1",
        line: "#DEDAD0",
        signal: "#C8481E",   // violation / restricted
        ok: "#3E5C3A",       // legal parking / resolved
        amber: "#B8792B",
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
