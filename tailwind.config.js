/** @type {import('tailwindcss').Config} */

// Colors reference CSS variables (RGB channel triples) defined in globals.css so
// the same utility classes work in both the dark and light themes. The
// `<alpha-value>` placeholder keeps Tailwind opacity modifiers (e.g. bg-arsist-accent/20)
// working. Switch themes by setting `data-theme="light"` on <html>.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: [
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        arsist: {
          bg: v('--arsist-bg'),
          surface: v('--arsist-surface'),
          border: v('--arsist-border'),
          hover: v('--arsist-hover'),
          active: v('--arsist-active'),
          primary: v('--arsist-primary'),
          accent: v('--arsist-accent'),
          text: v('--arsist-text'),
          muted: v('--arsist-muted'),
          success: v('--arsist-success'),
          warning: v('--arsist-warning'),
          error: v('--arsist-error'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
