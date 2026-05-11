from fastapi import APIRouter
from ..client import order_client, invoice_client, forward
import asyncio

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("")
async def get_dashboard():
    """
    Aggregates data from Order Service and Invoice Service in parallel.
    Returns a single response the frontend uses for the Dashboard page.
    """
    orders_task   = forward(order_client,   "GET", "/orders")
    invoices_task = forward(invoice_client, "GET", "/invoices")

    orders, invoices = await asyncio.gather(orders_task, invoices_task, return_exceptions=True)

    # Gracefully handle if a downstream service is down
    if isinstance(orders, Exception):
        orders = []
    if isinstance(invoices, Exception):
        invoices = []

    # Aggregate order stats
    total_orders    = len(orders)
    total_revenue   = round(sum(o.get("total", 0) for o in orders), 2)
    pending_orders  = sum(1 for o in orders if o.get("status") == "Pending")
    processing      = sum(1 for o in orders if o.get("status") == "Processing")
    shipped         = sum(1 for o in orders if o.get("status") == "Shipped")
    delivered       = sum(1 for o in orders if o.get("status") == "Delivered")
    cancelled       = sum(1 for o in orders if o.get("status") == "Cancelled")

    # Aggregate invoice stats
    total_unpaid    = round(sum(i.get("total", 0) for i in invoices if i.get("status") == "Unpaid"), 2)
    total_overdue   = round(sum(i.get("total", 0) for i in invoices if i.get("status") == "Overdue"), 2)
    total_paid      = round(sum(i.get("total", 0) for i in invoices if i.get("status") == "Paid"), 2)

    # Recent orders (last 6)
    recent_orders = sorted(orders, key=lambda o: o.get("created_at", ""), reverse=True)[:6]

    return {
        "stats": {
            "total_orders":     total_orders,
            "total_revenue":    total_revenue,
            "pending_orders":   pending_orders,
            "processing_orders":processing,
            "shipped_orders":   shipped,
            "delivered_orders": delivered,
            "cancelled_orders": cancelled,
        },
        "invoice_summary": {
            "total_paid":    total_paid,
            "total_unpaid":  total_unpaid,
            "total_overdue": total_overdue,
        },
        "recent_orders": recent_orders,
    }
