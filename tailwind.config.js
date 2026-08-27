/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Thmanyah', 'Manrope', 'Tajawal', 'system-ui', 'sans-serif'],
        latin: ['Manrope', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: 'var(--bg)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        surface: 'var(--surface)',
        border: 'var(--border)',
      },
    },
  },
  plugins: [],
}
