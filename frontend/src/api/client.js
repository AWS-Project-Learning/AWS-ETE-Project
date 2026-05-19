// API client — all calls go to the BFF via /api/*
// In production: CloudFront routes /api/* → ALB → BFF (same domain, no CORS)
// In local dev:  calls http://localhost:8000/api/* directly

const BASE = import.meta.env.VITE_API_BASE_URL ?? ""

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Request failed")
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export const getDashboard = () => request("GET", "/api/dashboard")

// ── Orders ─────────────────────────────────────────────────────────────────
export const listOrders  = (status) => request("GET", status ? `/api/orders?status=${status}` : "/api/orders")
export const getOrder    = (id)     => request("GET", `/api/orders/${id}`)
export const createOrder = (data)   => request("POST", "/api/orders", data)
export const updateOrderStatus  = (id, status)  => request("PATCH", `/api/orders/${id}/status`,  { status })
export const updateOrderPayment = (id, payment) => request("PATCH", `/api/orders/${id}/payment`, { payment_status: payment })
export const deleteOrder = (id) => request("DELETE", `/api/orders/${id}`)

// ── Invoices ───────────────────────────────────────────────────────────────
export const listInvoices = (status) => request("GET", status ? `/api/invoices?status=${status}` : "/api/invoices")
export const getInvoice   = (id)     => request("GET", `/api/invoices/${id}`)

// ── Security — calls /security/* which routes via ALB directly to Lambda ───
// These calls NEVER touch the BFF. CloudFront → ALB → Lambda target group.
export const triggerScan       = (config = {})  => request("POST", "/security/scan",         config)
export const triggerReason     = (scan_id)       => request("POST", "/security/reason",       scan_id ? { scan_id } : {})
export const triggerPatch      = (scan_id)       => request("POST", "/security/patch",        scan_id ? { scan_id } : {})
export const approveProdPatch  = (payload)       => request("POST", "/security/approve",      payload)
export const getSecurityStatus  = ()             => request("GET",  "/security/status")
export const getSecurityResults = ()             => request("GET",  "/security/results")
