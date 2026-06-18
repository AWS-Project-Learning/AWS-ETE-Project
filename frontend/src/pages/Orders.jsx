import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Filter } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { listOrders } from '../api/client'

const STATUS_FILTERS = ['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']

export default function Orders() {
  const navigate = useNavigate()
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('All')

  useEffect(() => {
    listOrders()
      .then(setOrders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = orders.filter(o => {
    const matchSearch = o.customer_name?.toLowerCase().includes(search.toLowerCase()) || o.id?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = status === 'All' || o.status === status
    return matchSearch && matchStatus
  })

  if (loading) return <div className="p-8 text-gray-400">Loading orders…</div>
  if (error)   return <div className="p-8 text-red-500">Error: {error}</div>

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-500 text-sm mt-1">{orders.length} total orders</p>
        </div>
        <button
          onClick={() => navigate('/orders/new')}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          + New Order
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-gray-400" />
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                ${status === s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
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
                {['Order ID', 'Customer', 'Email', 'Items', 'Total', 'Payment', 'Status', 'Date'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">No orders found.</td>
                </tr>
              ) : (
                filtered.map((o, i) => (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className={`cursor-pointer hover:bg-brand-50 transition-colors ${i !== filtered.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <td className="px-6 py-4 font-mono text-brand-600 font-medium">{o.id}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{o.customer_name}</td>
                    <td className="px-6 py-4 text-gray-400">{o.email}</td>
                    <td className="px-6 py-4 text-gray-500">{o.item_count ?? '-'}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">${o.total?.toLocaleString()}</td>
                    <td className="px-6 py-4"><StatusBadge status={o.payment_status} /></td>
                    <td className="px-6 py-4"><StatusBadge status={o.status} /></td>
                    <td className="px-6 py-4 text-gray-400">{o.created_at?.split('T')[0]}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filtered.length} of {orders.length} orders
        </div>
      </div>
    </div>
  )
}
