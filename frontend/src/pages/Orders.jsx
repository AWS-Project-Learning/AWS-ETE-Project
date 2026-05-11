import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Filter } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { orders } from '../data/mockData'

const STATUS_FILTERS = ['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']

export default function Orders() {
  const navigate = useNavigate()
  const [search, setSearch]   = useState('')
  const [status, setStatus]   = useState('All')

  const filtered = orders.filter(o => {
    const matchSearch = o.customer.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase())
    const matchStatus = status === 'All' || o.status === status
    return matchSearch && matchStatus
  })

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
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          + New Order
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-gray-400" />
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                ${status === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                    className={`cursor-pointer hover:bg-indigo-50 transition-colors ${i !== filtered.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <td className="px-6 py-4 font-mono text-indigo-600 font-medium">{o.id}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{o.customer}</td>
                    <td className="px-6 py-4 text-gray-400">{o.email}</td>
                    <td className="px-6 py-4 text-gray-500">{o.items}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">${o.total.toLocaleString()}</td>
                    <td className="px-6 py-4"><StatusBadge status={o.paymentStatus} /></td>
                    <td className="px-6 py-4"><StatusBadge status={o.status} /></td>
                    <td className="px-6 py-4 text-gray-400">{o.date}</td>
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
