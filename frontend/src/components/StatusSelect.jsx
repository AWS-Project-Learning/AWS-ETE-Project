import { ChevronDown, Loader2 } from 'lucide-react'

// Reuse the badge colour palette so the pill looks identical to the read-only
// StatusBadge — just with a chevron and click target.
const COLOURS = {
  Delivered:  'bg-green-100 text-green-700  hover:bg-green-200',
  Processing: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
  Pending:    'bg-amber-100 text-amber-700  hover:bg-amber-200',
  Shipped:    'bg-blue-100 text-blue-700   hover:bg-blue-200',
  Cancelled:  'bg-red-100 text-red-700     hover:bg-red-200',
  Paid:       'bg-green-100 text-green-700  hover:bg-green-200',
  Unpaid:     'bg-amber-100 text-amber-700  hover:bg-amber-200',
  Refunded:   'bg-gray-100 text-gray-600    hover:bg-gray-200',
}

export default function StatusSelect({ value, options, onChange, disabled, saving }) {
  const colour = COLOURS[value] ?? 'bg-gray-100 text-gray-600 hover:bg-gray-200'

  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        disabled={disabled || saving}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none cursor-pointer pl-3 pr-7 py-1 rounded-full text-xs font-medium
          transition-colors disabled:opacity-60 disabled:cursor-wait
          focus:outline-none focus:ring-2 focus:ring-indigo-300
          ${colour}`}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        {saving
          ? <Loader2 size={12} className="animate-spin opacity-70" />
          : <ChevronDown size={12} className="opacity-70" />}
      </span>
    </div>
  )
}
