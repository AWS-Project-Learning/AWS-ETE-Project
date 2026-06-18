import { useState, useEffect } from 'react'
import { ShoppingCart, DollarSign, Clock, CheckCircle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { useNavigate } from 'react-router-dom'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { getDashboard } from '../api/client'

const STATUS_COLORS = {
  Delivered:  '#22c55e',
  Processing: '#009c99',
  Pending:    '#f59e0b',
  Shipped:    '#3b82f6',
  Cancelled:  '#ef4444',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-gray-400">Loading dashboard…</div>
  if (error)   return <div className="p-8 text-red-500">Error: {error}</div>

  const { stats, recent_orders } = data

  // Build status distribution from stats for pie chart
  const statusDistribution = Object.entries({
    Delivered:  stats.delivered_orders,
    Processing: stats.processing_orders,
    Pending:    stats.pending_orders,
    Shipped:    stats.shipped_orders,
    Cancelled:  stats.cancelled_orders,
  }).map(([name, value]) => ({ name, value, color: STATUS_COLORS[name] }))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back, Rajesh. Here's what's happening.</p>
        </div>
        <button
          onClick={() => navigate('/orders/new')}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          + New Order
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Orders"   value={stats.total_orders}                          icon={ShoppingCart} color="bg-brand-500" sub="All time" />
        <StatCard label="Total Revenue"  value={`$${stats.total_revenue.toLocaleString()}`}  icon={DollarSign}   color="bg-green-500"  sub="All time" />
        <StatCard label="Pending Orders" value={stats.pending_orders}                         icon={Clock}        color="bg-amber-500"  sub="Awaiting processing" />
        <StatCard label="Delivered"      value={stats.delivered_orders}                       icon={CheckCircle}  color="bg-blue-500"   sub="Successfully delivered" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        {/* Status Pie Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Order Status</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusDistribution} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                {statusDistribution.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12, color: '#6b7280' }}>{v}</span>} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Recent Orders</h2>
          <button onClick={() => navigate('/orders')} className="text-brand-600 text-sm font-medium hover:underline">
            View all
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Order ID', 'Customer', 'Items', 'Total', 'Status', 'Date'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent_orders.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-12">No orders yet.</td></tr>
              ) : recent_orders.map((o, i) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/orders/${o.id}`)}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${i !== recent_orders.length - 1 ? 'border-b border-gray-50' : ''}`}
                >
                  <td className="px-6 py-4 font-mono text-brand-600 font-medium">{o.id}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{o.customer_name}</td>
                  <td className="px-6 py-4 text-gray-500">{o.item_count ?? '-'}</td>
                  <td className="px-6 py-4 font-semibold text-gray-900">${o.total?.toLocaleString()}</td>
                  <td className="px-6 py-4"><StatusBadge status={o.status} /></td>
                  <td className="px-6 py-4 text-gray-400">{o.created_at?.split('T')[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
