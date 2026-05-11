from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import Order, OrderItem, OrderStatus
from ..schemas import OrderCreate, OrderResponse, OrderListResponse, OrderStatusUpdate, OrderPaymentUpdate
from ..events import publish

router = APIRouter(prefix="/orders", tags=["Orders"])


def _calculate_totals(items):
    subtotal = round(sum(i.quantity * i.unit_price for i in items), 2)
    tax      = round(subtotal * 0.10, 2)
    total    = round(subtotal + tax, 2)
    return subtotal, tax, total


@router.post("", response_model=OrderResponse, status_code=201)
def create_order(payload: OrderCreate, db: Session = Depends(get_db)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    order = Order(
        customer_name=payload.customer_name,
        email=payload.email,
        address=payload.address,
    )
    db.add(order)
    db.flush()

    for item_data in payload.items:
        item = OrderItem(
            order_id=order.id,
            product_name=item_data.product_name,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price,
        )
        db.add(item)

    db.commit()
    db.refresh(order)

    subtotal, tax, total = _calculate_totals(order.items)

    publish("order.created", {
        "order_id":      order.id,
        "customer_name": order.customer_name,
        "email":         order.email,
        "total":         total,
        "status":        order.status.value,
    })

    return _to_response(order, subtotal, tax, total)


@router.get("", response_model=List[OrderListResponse])
def list_orders(
    status: Optional[OrderStatus] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == status)
    orders = query.order_by(Order.created_at.desc()).all()

    result = []
    for o in orders:
        _, _, total = _calculate_totals(o.items)
        result.append(OrderListResponse(
            id=o.id,
            customer_name=o.customer_name,
            email=o.email,
            status=o.status,
            payment_status=o.payment_status,
            item_count=len(o.items),
            total=total,
            created_at=o.created_at,
        ))
    return result


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    subtotal, tax, total = _calculate_totals(order.items)
    return _to_response(order, subtotal, tax, total)


@router.patch("/{order_id}/status", response_model=OrderResponse)
def update_order_status(order_id: str, payload: OrderStatusUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    order.status = payload.status
    db.commit()
    db.refresh(order)

    subtotal, tax, total = _calculate_totals(order.items)

    publish("order.status_updated", {
        "order_id": order.id,
        "status":   order.status.value,
        "total":    total,
        "email":    order.email,
    })

    return _to_response(order, subtotal, tax, total)


@router.patch("/{order_id}/payment", response_model=OrderResponse)
def update_payment_status(order_id: str, payload: OrderPaymentUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    order.payment_status = payload.payment_status
    db.commit()
    db.refresh(order)

    subtotal, tax, total = _calculate_totals(order.items)
    return _to_response(order, subtotal, tax, total)


@router.delete("/{order_id}", status_code=204)
def delete_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")
    db.delete(order)
    db.commit()


def _to_response(order, subtotal, tax, total) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        customer_name=order.customer_name,
        email=order.email,
        address=order.address,
        status=order.status,
        payment_status=order.payment_status,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[
            {"id": i.id, "product_name": i.product_name, "quantity": i.quantity, "unit_price": i.unit_price, "total": i.total}
            for i in order.items
        ],
        subtotal=subtotal,
        tax=tax,
        total=total,
    )
