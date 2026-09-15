/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Thmanyah', 'Manrope', 'Tajawal', 'system-ui', 'sans-serif'],
        latin: ['Manrope', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      // Colors come from the approved tokens in src/index.css so light and
      // dark themes switch automatically. Opacity modifiers (bg-primary/10)
      // are not supported for these; use the *-soft tokens instead.
      colors: {
        bg: 'var(--bg)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        surface: {
          DEFAULT: 'var(--surface)',
          hover: 'var(--surface-hover)',
        },
        border: 'var(--border)',
        ring: 'var(--ring)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          contrast: 'var(--primary-contrast)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
        entry: { DEFAULT: 'var(--entry)', soft: 'var(--entry-soft)' },
        exit: { DEFAULT: 'var(--exit)', soft: 'var(--exit-soft)' },
      },
      // A bare `border` uses the theme border instead of Tailwind's gray-200,
      // which previously showed a light border in dark mode.
      borderColor: {
        DEFAULT: 'var(--border)',
      },
    },
  },
  plugins: [],
}
