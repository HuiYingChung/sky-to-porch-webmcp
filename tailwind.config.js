/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Semantic token extensions bridge CSS custom properties into Tailwind
      // utilities. These mirror the tokens defined in globals.css.
      colors: {
        canvas: {
          DEFAULT: "var(--canvas-bg)",
          subtle: "var(--canvas-bg-subtle)",
        },
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          link: "var(--text-link)",
        },
        focus: "var(--focus-ring)",
        "status-error": {
          bg: "var(--status-error-bg)",
          fg: "var(--status-error-fg)",
          border: "var(--status-error-border)",
        },
      },
      screens: {
        // Explicit WP-03 breakpoints
        desktop: "1024px",
      },
    },
  },
  plugins: [],
};
