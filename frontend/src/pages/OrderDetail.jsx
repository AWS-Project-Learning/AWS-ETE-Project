import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Circle, Download } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { orderDetails, orders } from '../data/mockData'

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const order = orderDetails[id] || orders.find(o => o.id === id)

  if (!order) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p className="text-lg">Order not found.</p>
        <button onClick={() => navigate('/orders')} className="mt-4 text-indigo-600 hover:underline text-sm">Back to Orders</button>
      </div>
    )
  }

  const detail = orderDetails[id]

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
          <p className="text-gray-400 text-sm mt-1">Placed on {order.date}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} />
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 text-sm px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <Download size={14} /> Invoice
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — items + totals */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
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
                {detail?.items?.map((item, i) => (
                  <tr key={i} className={i !== detail.items.length - 1 ? 'border-b border-gray-50' : ''}>
                    <td className="px-6 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-3 text-gray-500">{item.qty}</td>
                    <td className="px-6 py-3 text-gray-500">${item.unitPrice.toFixed(2)}</td>
                    <td className="px-6 py-3 font-semibold text-gray-900">${item.total.toFixed(2)}</td>
                  </tr>
                )) ?? (
                  <tr><td colSpan={4} className="px-6 py-4 text-gray-400 text-center">Item details not available.</td></tr>
                )}
              </tbody>
            </table>
            {detail && (
              <div className="px-6 py-4 border-t border-gray-100 space-y-2">
                {[
                  ['Subtotal',  `$${detail.subtotal.toFixed(2)}`],
                  ['Tax (10%)', `$${detail.tax.toFixed(2)}`],
                  ['Shipping',  detail.shipping === 0 ? 'Free' : `$${detail.shipping.toFixed(2)}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm text-gray-500"><span>{k}</span><span>{v}</span></div>
                ))}
                <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-100">
                  <span>Grand Total</span><span>${detail.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Order Timeline */}
          {detail?.timeline && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-5">Order Timeline</h2>
              <div className="space-y-4">
                {detail.timeline.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    {step.done
                      ? <CheckCircle size={18} className="text-green-500 mt-0.5 shrink-0" />
                      : <Circle size={18} className="text-gray-300 mt-0.5 shrink-0" />}
                    <div>
                      <p className={`text-sm font-medium ${step.done ? 'text-gray-900' : 'text-gray-400'}`}>{step.status}</p>
                      {step.date && <p className="text-xs text-gray-400">{step.date}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — customer + payment */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Customer</h2>
            <p className="text-sm font-medium text-gray-900">{order.customer}</p>
            <p className="text-sm text-gray-400 mt-1">{order.email}</p>
            {detail?.address && <p className="text-sm text-gray-400 mt-2">{detail.address}</p>}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Payment</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Status</span>
                <StatusBadge status={order.paymentStatus} />
              </div>
              {detail?.paymentMethod && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Method</span>
                  <span className="text-gray-700 font-medium">{detail.paymentMethod}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
