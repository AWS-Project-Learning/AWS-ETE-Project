from fastapi import APIRouter, Query
from typing import Optional
import logging

from ..client import order_client, invoice_client, forward

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/orders", tags=["Orders"])


@router.post("", status_code=201)
async def create_order(payload: dict):
    order = await forward(order_client, "POST", "/orders", json=payload)

    # Create the invoice synchronously — invoice-service listens for a Redis
    # event in the ideal architecture, but we don't have Redis yet. Creating
    # it here in the BFF is the reliable fallback.
    try:
        subtotal = round(order["total"] / 1.10, 2)
        tax      = round(order["total"] - subtotal, 2)
        await forward(invoice_client, "POST", "/invoices", json={
            "order_id":      order["id"],
            "customer_name": order["customer_name"],
            "email":         order["email"],
            "subtotal":      subtotal,
            "tax":           tax,
            "total":         order["total"],
        })
    except Exception as e:
        logger.warning(f"Invoice auto-create failed for order {order.get('id')}: {e}")

    return order


@router.get("")
async def list_orders(status: Optional[str] = Query(None)):
    params = {"status": status} if status else {}
    return await forward(order_client, "GET", "/orders", params=params)


@router.get("/{order_id}")
async def get_order(order_id: str):
    return await forward(order_client, "GET", f"/orders/{order_id}")


@router.patch("/{order_id}/status")
async def update_order_status(order_id: str, payload: dict):
    return await forward(order_client, "PATCH", f"/orders/{order_id}/status", json=payload)


@router.patch("/{order_id}/payment")
async def update_order_payment(order_id: str, payload: dict):
    order = await forward(order_client, "PATCH", f"/orders/{order_id}/payment", json=payload)

    # Sync the matching invoice status so both services stay consistent.
    # Order payment_status values map 1-to-1 with invoice status values.
    payment_status = payload.get("payment_status", "")
    invoice_status_map = {
        "Paid":     "Paid",
        "Refunded": "Refunded",
        "Pending":  "Unpaid",
    }
    mapped = invoice_status_map.get(payment_status)
    if mapped:
        try:
            invoice = await forward(invoice_client, "GET", f"/invoices/by-order/{order_id}")
            await forward(invoice_client, "PATCH", f"/invoices/{invoice['id']}/payment", json={"status": mapped})
        except Exception as e:
            logger.warning(f"Invoice sync failed for order {order_id}: {e}")

    return order


@router.delete("/{order_id}", status_code=204)
async def delete_order(order_id: str):
    await forward(order_client, "DELETE", f"/orders/{order_id}")
