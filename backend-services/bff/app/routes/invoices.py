from fastapi import APIRouter, Query
from typing import Optional
from ..client import invoice_client, forward

router = APIRouter(prefix="/api/invoices", tags=["Invoices"])


@router.get("")
async def list_invoices(status: Optional[str] = Query(None)):
    params = {"status": status} if status else {}
    return await forward(invoice_client, "GET", "/invoices", params=params)


@router.get("/by-order/{order_id}")
async def get_invoice_by_order(order_id: str):
    return await forward(invoice_client, "GET", f"/invoices/by-order/{order_id}")


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str):
    return await forward(invoice_client, "GET", f"/invoices/{invoice_id}")


@router.patch("/{invoice_id}/payment")
async def update_invoice_payment(invoice_id: str, payload: dict):
    return await forward(invoice_client, "PATCH", f"/invoices/{invoice_id}/payment", json=payload)


@router.delete("/{invoice_id}", status_code=204)
async def delete_invoice(invoice_id: str):
    await forward(invoice_client, "DELETE", f"/invoices/{invoice_id}")
