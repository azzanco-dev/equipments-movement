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
        placeholder: 'var(--placeholder)',
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
      // Opacity-only fade for overlays whose transform must not be overridden
      // (dialogs, menus, select lists). Used as data-[state=open]:animate-*.
      keyframes: {
        'fade-in-opacity': { from: { opacity: '0' }, to: { opacity: '1' } },
        // Toast enter/exit: same slide+fade in both directions (the toast
        // stack sits at the bottom in both RTL and LTR, so a vertical slide
        // needs no direction-specific variant).
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-out': {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(16px)' },
        },
        'toast-swipe-out': {
          from: { opacity: '1' },
          to: { opacity: '0', transform: 'translateY(100%)' },
        },
      },
      animation: {
        'fade-in-opacity': 'fade-in-opacity 0.15s ease-out',
        'toast-in': 'toast-in 0.2s ease-out',
        'toast-out': 'toast-out 0.15s ease-in forwards',
        'toast-swipe-out': 'toast-swipe-out 0.15s ease-in forwards',
      },
    },
  },
  plugins: [],
}
