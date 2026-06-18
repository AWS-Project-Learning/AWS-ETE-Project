const config = {
  Delivered:  'bg-green-100 text-green-700',
  Processing: 'bg-brand-100 text-brand-700',
  Pending:    'bg-amber-100 text-amber-700',
  Shipped:    'bg-blue-100 text-blue-700',
  Cancelled:  'bg-red-100 text-red-700',
  Paid:       'bg-green-100 text-green-700',
  Unpaid:     'bg-amber-100 text-amber-700',
  Overdue:    'bg-red-100 text-red-700',
  Refunded:   'bg-gray-100 text-gray-600',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}
