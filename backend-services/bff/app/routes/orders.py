from fastapi import APIRouter, Query
from typing import Optional
from ..client import order_client, forward

router = APIRouter(prefix="/api/orders", tags=["Orders"])


@router.post("", status_code=201)
async def create_order(payload: dict):
    return await forward(order_client, "POST", "/orders", json=payload)


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
    return await forward(order_client, "PATCH", f"/orders/{order_id}/payment", json=payload)


@router.delete("/{order_id}", status_code=204)
async def delete_order(order_id: str):
    await forward(order_client, "DELETE", f"/orders/{order_id}")
