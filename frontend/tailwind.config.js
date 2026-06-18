/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    // SecurityScan agent-card dynamic colours (teal-family + accents)
    'bg-brand-50',   'text-brand-600',  'ring-brand-200',   'bg-brand-600',   'bg-brand-500',
    'bg-cyan-50',    'text-cyan-600',   'ring-cyan-200',    'bg-cyan-600',     'bg-cyan-500',
    'bg-sky-50',     'text-sky-600',    'ring-sky-200',     'bg-sky-600',      'bg-sky-500',
    'bg-amber-50',   'text-amber-600',  'ring-amber-200',   'bg-amber-600',    'bg-amber-500',
    'bg-emerald-50', 'text-emerald-600','ring-emerald-200', 'bg-emerald-600',  'bg-emerald-500',
    'bg-orange-50',  'text-orange-600', 'ring-orange-200',  'bg-orange-600',   'bg-orange-500',
    'ring-4', 'ring-2',
    'bg-brand-600', 'bg-cyan-600', 'bg-sky-600', 'bg-amber-600', 'bg-emerald-600',
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand — teal, from the "Leadership consultants" template (#009c99)
        brand: {
          50:  '#e6f6f6',
          100: '#c4eae9',
          200: '#9bdcda',
          300: '#66cac7',
          400: '#1fb3b0',
          500: '#009c99',
          600: '#008c8a',
          700: '#00706e',
          800: '#015553',
          900: '#063e3d',
        },
        // Secondary accents from the same template palette
        accent: {
          cyan:   '#22bfe1',
          orange: '#fd6034',
          gold:   '#f1c50e',
          slate:  '#b9c1cc',
        },
      },
    },
  },
  plugins: [],
}
