/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    // SecurityScan agent-card dynamic colours
    'bg-indigo-50',  'text-indigo-600', 'ring-indigo-200',  'bg-indigo-600',  'bg-indigo-500',
    'bg-blue-50',    'text-blue-600',   'ring-blue-200',    'bg-blue-600',    'bg-blue-500',
    'bg-violet-50',  'text-violet-600', 'ring-violet-200',  'bg-violet-600',  'bg-violet-500',
    'bg-teal-50',    'text-teal-600',   'ring-teal-200',    'bg-teal-600',    'bg-teal-500',
    'bg-emerald-50', 'text-emerald-600','ring-emerald-200', 'bg-emerald-600', 'bg-emerald-500',
    'ring-4', 'ring-2',
    // status badge backgrounds used dynamically
    'bg-indigo-600', 'bg-blue-600', 'bg-violet-600', 'bg-teal-600', 'bg-emerald-600',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
    },
  },
  plugins: [],
}
