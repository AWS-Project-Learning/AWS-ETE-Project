import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

const PRODUCTS = [
  { id: 1, name: 'Wireless Keyboard',  price: 120.00 },
  { id: 2, name: 'USB-C Hub',          price: 85.00  },
  { id: 3, name: 'Monitor Stand',      price: 915.00 },
  { id: 4, name: 'Office Chair',       price: 380.50 },
  { id: 5, name: 'Desk Lamp',          price: 200.00 },
  { id: 6, name: 'Laptop Stand',       price: 65.00  },
]

export default function NewOrder() {
  const navigate = useNavigate()
  const [customer, setCustomer] = useState('')
  const [email, setEmail]       = useState('')
  const [address, setAddress]   = useState('')
  const [items, setItems]       = useState([{ productId: '', qty: 1 }])
  const [submitted, setSubmitted] = useState(false)

  const addItem    = () => setItems(prev => [...prev, { productId: '', qty: 1 }])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))
  const updateItem = (i, field, value) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item))

  const getProduct = (id) => PRODUCTS.find(p => p.id === Number(id))

  const subtotal = items.reduce((sum, item) => {
    const p = getProduct(item.productId)
    return sum + (p ? p.price * item.qty : 0)
  }, 0)
  const tax   = subtotal * 0.1
  const total = subtotal + tax

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
    setTimeout(() => navigate('/orders'), 1500)
  }

  if (submitted) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="bg-green-100 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Order Created!</h2>
        <p className="text-gray-400 text-sm mt-1">Redirecting to orders...</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <button onClick={() => navigate('/orders')} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Orders
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-8">Create New Order</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Customer Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer Name *</label>
              <input required value={customer} onChange={e => setCustomer(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Acme Corp" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="billing@acme.com" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Delivery Address</label>
            <input value={address} onChange={e => setAddress(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="123 Main St, City, State" />
          </div>
        </div>

        {/* Order items */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Order Items</h2>
            <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-indigo-600 text-sm font-medium hover:underline">
              <Plus size={14} /> Add Item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((item, i) => {
              const product = getProduct(item.productId)
              return (
                <div key={i} className="flex items-center gap-3">
                  <select
                    required
                    value={item.productId}
                    onChange={e => updateItem(i, 'productId', e.target.value)}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">Select product...</option>
                    {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name} — ${p.price}</option>)}
                  </select>
                  <input
                    type="number" min="1" value={item.qty}
                    onChange={e => updateItem(i, 'qty', Number(e.target.value))}
                    className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <span className="w-24 text-sm font-medium text-gray-700 text-right">
                    {product ? `$${(product.price * item.qty).toFixed(2)}` : '—'}
                  </span>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Totals */}
          <div className="mt-6 pt-4 border-t border-gray-100 space-y-2">
            {[['Subtotal', `$${subtotal.toFixed(2)}`], ['Tax (10%)', `$${tax.toFixed(2)}`]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm text-gray-500"><span>{k}</span><span>{v}</span></div>
            ))}
            <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate('/orders')}
            className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit"
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
            Create Order
          </button>
        </div>
      </form>
    </div>
  )
}
