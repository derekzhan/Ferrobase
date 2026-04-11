/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Dark theme
        "bg-primary": "var(--bg-primary)",
        "bg-secondary": "var(--bg-secondary)",
        "bg-hover": "var(--bg-hover)",
        accent: "var(--accent)",
        "text-primary": "var(--text-primary)",
        "text-muted": "var(--text-muted)",
        border: "var(--border)",
        success: "var(--success)",
        error: "var(--error)",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
};
