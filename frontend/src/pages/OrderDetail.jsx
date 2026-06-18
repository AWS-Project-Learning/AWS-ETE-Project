import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import StatusSelect from '../components/StatusSelect'
import { getOrder, updateOrderStatus, updateOrderPayment } from '../api/client'

const STATUS_OPTIONS  = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']
const PAYMENT_OPTIONS = ['Unpaid', 'Paid', 'Refunded']

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order,   setOrder]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [saving,    setSaving]    = useState(null)   // 'status' | 'payment' | null
  const [updateErr, setUpdateErr] = useState(null)

  useEffect(() => {
    getOrder(id)
      .then(setOrder)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  // Optimistic update: flip the field immediately, call API, roll back on failure.
  // Keeps the UI snappy even if the BFF/order-service is slow.
  const updateField = async (field, apiCall, newValue) => {
    if (!order || saving) return
    const prev = order[field]
    if (prev === newValue) return

    setSaving(field)
    setUpdateErr(null)
    setOrder(o => ({ ...o, [field]: newValue }))

    try {
      const updated = await apiCall(order.id, newValue)
      setOrder(updated)
    } catch (e) {
      setOrder(o => ({ ...o, [field]: prev }))
      setUpdateErr(e.message || `Failed to update ${field}`)
    } finally {
      setSaving(null)
    }
  }

  const onChangeStatus  = (v) => updateField('status',         updateOrderStatus,  v)
  const onChangePayment = (v) => updateField('payment_status', updateOrderPayment, v)

  if (loading) return <div className="p-8 text-gray-400">Loading order…</div>
  if (error)   return (
    <div className="p-8 text-center text-gray-400">
      <p className="text-lg">Order not found.</p>
      <button onClick={() => navigate('/orders')} className="mt-4 text-brand-600 hover:underline text-sm">Back to Orders</button>
    </div>
  )

  return (
    <div className="p-8 max-w-5xl">
      {/* Back */}
      <button onClick={() => navigate('/orders')} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Orders
      </button>

      {/* Title row */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{order.id}</h1>
          <p className="text-gray-400 text-sm mt-1">Placed on {order.created_at?.split('T')[0]}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusSelect
            value={order.status}
            options={STATUS_OPTIONS}
            onChange={onChangeStatus}
            saving={saving === 'status'}
          />
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 text-sm px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <Download size={14} /> Invoice
          </button>
        </div>
      </div>

      {updateErr && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {updateErr}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — items + totals */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Order Items</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  {['Product', 'Qty', 'Unit Price', 'Total'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.items?.length ? order.items.map((item, i) => (
                  <tr key={i} className={i !== order.items.length - 1 ? 'border-b border-gray-50' : ''}>
                    <td className="px-6 py-3 font-medium text-gray-900">{item.product_name}</td>
                    <td className="px-6 py-3 text-gray-500">{item.quantity}</td>
                    <td className="px-6 py-3 text-gray-500">${item.unit_price?.toFixed(2)}</td>
                    <td className="px-6 py-3 font-semibold text-gray-900">${item.total?.toFixed(2)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="px-6 py-4 text-gray-400 text-center">No items.</td></tr>
                )}
              </tbody>
            </table>
            <div className="px-6 py-4 border-t border-gray-100 space-y-2">
              {[
                ['Subtotal', `$${order.subtotal?.toFixed(2) ?? '—'}`],
                ['Tax',      `$${order.tax?.toFixed(2) ?? '—'}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm text-gray-500"><span>{k}</span><span>{v}</span></div>
              ))}
              <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-100">
                <span>Grand Total</span><span>${order.total?.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right — customer + payment */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Customer</h2>
            <p className="text-sm font-medium text-gray-900">{order.customer_name}</p>
            <p className="text-sm text-gray-400 mt-1">{order.email}</p>
            {order.address && <p className="text-sm text-gray-400 mt-2">{order.address}</p>}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Payment</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Status</span>
                <StatusSelect
                  value={order.payment_status}
                  options={PAYMENT_OPTIONS}
                  onChange={onChangePayment}
                  saving={saving === 'payment'}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Order Total</span>
                <span className="text-gray-700 font-medium">${order.total?.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
