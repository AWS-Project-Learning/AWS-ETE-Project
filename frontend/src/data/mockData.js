export const orders = [
  { id: 'ORD-1001', customer: 'Acme Corp',      email: 'billing@acme.com',      items: 4, total: 1240.00, status: 'Delivered',  date: '2026-05-10', paymentStatus: 'Paid' },
  { id: 'ORD-1002', customer: 'Globex Inc',     email: 'orders@globex.com',     items: 2, total: 580.50,  status: 'Processing', date: '2026-05-10', paymentStatus: 'Paid' },
  { id: 'ORD-1003', customer: 'Initech Ltd',    email: 'ap@initech.com',        items: 7, total: 3120.00, status: 'Pending',    date: '2026-05-09', paymentStatus: 'Unpaid' },
  { id: 'ORD-1004', customer: 'Umbrella Co',    email: 'purchasing@umbrella.co',items: 1, total: 99.99,   status: 'Shipped',    date: '2026-05-09', paymentStatus: 'Paid' },
  { id: 'ORD-1005', customer: 'Stark Industries',email: 'tony@stark.com',       items: 5, total: 8750.00, status: 'Delivered',  date: '2026-05-08', paymentStatus: 'Paid' },
  { id: 'ORD-1006', customer: 'Wayne Enterprises',email: 'bruce@wayne.com',     items: 3, total: 2100.00, status: 'Cancelled',  date: '2026-05-08', paymentStatus: 'Refunded' },
  { id: 'ORD-1007', customer: 'Pied Piper',     email: 'richard@piedpiper.com', items: 2, total: 450.00,  status: 'Processing', date: '2026-05-07', paymentStatus: 'Paid' },
  { id: 'ORD-1008', customer: 'Hooli Inc',      email: 'procurement@hooli.com', items: 6, total: 5400.00, status: 'Pending',    date: '2026-05-07', paymentStatus: 'Unpaid' },
  { id: 'ORD-1009', customer: 'Dunder Mifflin', email: 'michael@dm.com',        items: 10,total: 980.00,  status: 'Delivered',  date: '2026-05-06', paymentStatus: 'Paid' },
  { id: 'ORD-1010', customer: 'Vandelay Ind',   email: 'art@vandelay.com',      items: 2, total: 310.00,  status: 'Shipped',    date: '2026-05-06', paymentStatus: 'Paid' },
]

export const orderDetails = {
  'ORD-1001': {
    id: 'ORD-1001', customer: 'Acme Corp', email: 'billing@acme.com',
    address: '123 Market St, San Francisco, CA 94105',
    date: '2026-05-10', deliveredDate: '2026-05-11',
    status: 'Delivered', paymentStatus: 'Paid', paymentMethod: 'Credit Card',
    items: [
      { name: 'Wireless Keyboard',   qty: 2, unitPrice: 120.00, total: 240.00 },
      { name: 'USB-C Hub',           qty: 1, unitPrice: 85.00,  total: 85.00  },
      { name: 'Monitor Stand',       qty: 1, unitPrice: 915.00, total: 915.00 },
    ],
    subtotal: 1240.00, tax: 124.00, shipping: 0.00, grandTotal: 1364.00,
    timeline: [
      { status: 'Order Placed',  date: '2026-05-10 09:00', done: true },
      { status: 'Payment Confirmed', date: '2026-05-10 09:05', done: true },
      { status: 'Processing',    date: '2026-05-10 10:00', done: true },
      { status: 'Shipped',       date: '2026-05-10 15:30', done: true },
      { status: 'Delivered',     date: '2026-05-11 12:00', done: true },
    ],
  },
  'ORD-1002': {
    id: 'ORD-1002', customer: 'Globex Inc', email: 'orders@globex.com',
    address: '742 Evergreen Terrace, Springfield, IL 62701',
    date: '2026-05-10', deliveredDate: null,
    status: 'Processing', paymentStatus: 'Paid', paymentMethod: 'Bank Transfer',
    items: [
      { name: 'Office Chair',  qty: 1, unitPrice: 380.50, total: 380.50 },
      { name: 'Desk Lamp',     qty: 1, unitPrice: 200.00, total: 200.00 },
    ],
    subtotal: 580.50, tax: 58.05, shipping: 15.00, grandTotal: 653.55,
    timeline: [
      { status: 'Order Placed',     date: '2026-05-10 14:00', done: true },
      { status: 'Payment Confirmed',date: '2026-05-10 14:10', done: true },
      { status: 'Processing',       date: '2026-05-10 15:00', done: true },
      { status: 'Shipped',          date: null,               done: false },
      { status: 'Delivered',        date: null,               done: false },
    ],
  },
}

export const invoices = [
  { id: 'INV-2001', orderId: 'ORD-1001', customer: 'Acme Corp',       amount: 1364.00, issued: '2026-05-10', due: '2026-05-24', status: 'Paid' },
  { id: 'INV-2002', orderId: 'ORD-1002', customer: 'Globex Inc',      amount: 653.55,  issued: '2026-05-10', due: '2026-05-24', status: 'Paid' },
  { id: 'INV-2003', orderId: 'ORD-1003', customer: 'Initech Ltd',     amount: 3432.00, issued: '2026-05-09', due: '2026-05-23', status: 'Unpaid' },
  { id: 'INV-2004', orderId: 'ORD-1004', customer: 'Umbrella Co',     amount: 109.99,  issued: '2026-05-09', due: '2026-05-23', status: 'Paid' },
  { id: 'INV-2005', orderId: 'ORD-1005', customer: 'Stark Industries', amount: 9625.00, issued: '2026-05-08', due: '2026-05-22', status: 'Paid' },
  { id: 'INV-2006', orderId: 'ORD-1006', customer: 'Wayne Enterprises',amount: 2310.00, issued: '2026-05-08', due: '2026-05-22', status: 'Refunded' },
  { id: 'INV-2007', orderId: 'ORD-1007', customer: 'Pied Piper',      amount: 495.00,  issued: '2026-05-07', due: '2026-05-21', status: 'Paid' },
  { id: 'INV-2008', orderId: 'ORD-1008', customer: 'Hooli Inc',       amount: 5940.00, issued: '2026-05-07', due: '2026-05-21', status: 'Overdue' },
]

export const stats = {
  totalOrders: 148,
  totalRevenue: 84320.50,
  pendingOrders: 23,
  deliveredOrders: 102,
  processingOrders: 18,
  cancelledOrders: 5,
}

export const revenueData = [
  { month: 'Nov', revenue: 12400 },
  { month: 'Dec', revenue: 18200 },
  { month: 'Jan', revenue: 9800  },
  { month: 'Feb', revenue: 14600 },
  { month: 'Mar', revenue: 16300 },
  { month: 'Apr', revenue: 13020 },
  { month: 'May', revenue: 84320 },
]

export const statusDistribution = [
  { name: 'Delivered',  value: 102, color: '#22c55e' },
  { name: 'Processing', value: 18,  color: '#009c99' },
  { name: 'Pending',    value: 23,  color: '#f59e0b' },
  { name: 'Shipped',    value: 5,   color: '#3b82f6' },
  { name: 'Cancelled',  value: 5,   color: '#ef4444' },
]
