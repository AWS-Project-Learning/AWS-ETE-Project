import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { listInvoices } from '../api/client'

const STATUS_FILTERS = ['All', 'Paid', 'Unpaid', 'Overdue', 'Refunded']

export default function Invoices() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState('All')

  useEffect(() => {
    listInvoices()
      .then(setInvoices)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = invoices.filter(inv => {
    const matchSearch = inv.customer_name?.toLowerCase().includes(search.toLowerCase()) || inv.id?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = status === 'All' || inv.status === status
    return matchSearch && matchStatus
  })

  const totalUnpaid  = invoices.filter(i => i.status === 'Unpaid').reduce((s, i)  => s + (i.total ?? 0), 0)
  const totalOverdue = invoices.filter(i => i.status === 'Overdue').reduce((s, i) => s + (i.total ?? 0), 0)
  const totalPaid    = invoices.filter(i => i.status === 'Paid').reduce((s, i)    => s + (i.total ?? 0), 0)

  if (loading) return <div className="p-8 text-gray-400">Loading invoices…</div>
  if (error)   return <div className="p-8 text-red-500">Error: {error}</div>

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-500 text-sm mt-1">{invoices.length} total invoices</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Paid', value: `$${totalPaid.toLocaleString()}`,    color: 'bg-green-50 border-green-100',  text: 'text-green-700'  },
          { label: 'Unpaid',     value: `$${totalUnpaid.toLocaleString()}`,   color: 'bg-amber-50 border-amber-100',  text: 'text-amber-700'  },
          { label: 'Overdue',    value: `$${totalOverdue.toLocaleString()}`,  color: 'bg-red-50 border-red-100',      text: 'text-red-700'    },
        ].map(card => (
          <div key={card.label} className={`rounded-2xl border p-5 ${card.color}`}>
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 ${card.text}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by invoice ID or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                ${status === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Invoice', 'Order', 'Customer', 'Amount', 'Issued', 'Due', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-gray-400 py-12">No invoices found.</td></tr>
              ) : (
                filtered.map((inv, i) => (
                  <tr key={inv.id} className={`hover:bg-gray-50 transition-colors ${i !== filtered.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <td className="px-6 py-4 font-mono text-indigo-600 font-medium">{inv.id}</td>
                    <td className="px-6 py-4">
                      <button onClick={() => navigate(`/orders/${inv.order_id}`)} className="font-mono text-gray-500 hover:text-indigo-600 hover:underline transition-colors">
                        {inv.order_id}
                      </button>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{inv.customer_name}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">${inv.total?.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-400">{inv.issued_at?.split('T')[0]}</td>
                    <td className={`px-6 py-4 font-medium ${inv.status === 'Overdue' ? 'text-red-500' : 'text-gray-400'}`}>{inv.due_at?.split('T')[0]}</td>
                    <td className="px-6 py-4"><StatusBadge status={inv.status} /></td>
                    <td className="px-6 py-4">
                      <button className="text-gray-400 hover:text-indigo-600 transition-colors" title="Download invoice">
                        <Download size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filtered.length} of {invoices.length} invoices
        </div>
      </div>
    </div>
  )
}
