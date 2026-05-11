from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from .models import OrderStatus, PaymentStatus


# ── Order Item ────────────────────────────────────────────────────────────────

class OrderItemCreate(BaseModel):
    product_name: str
    quantity:     int
    unit_price:   float

class OrderItemResponse(BaseModel):
    id:           str
    product_name: str
    quantity:     int
    unit_price:   float
    total:        float

    class Config:
        from_attributes = True


# ── Order ─────────────────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    customer_name: str
    email:         str
    address:       Optional[str] = None
    items:         List[OrderItemCreate]

class OrderStatusUpdate(BaseModel):
    status: OrderStatus

class OrderPaymentUpdate(BaseModel):
    payment_status: PaymentStatus

class OrderResponse(BaseModel):
    id:             str
    customer_name:  str
    email:          str
    address:        Optional[str]
    status:         OrderStatus
    payment_status: PaymentStatus
    created_at:     datetime
    updated_at:     datetime
    items:          List[OrderItemResponse]
    subtotal:       float
    tax:            float
    total:          float

    class Config:
        from_attributes = True

class OrderListResponse(BaseModel):
    id:             str
    customer_name:  str
    email:          str
    status:         OrderStatus
    payment_status: PaymentStatus
    item_count:     int
    total:          float
    created_at:     datetime

    class Config:
        from_attributes = True
