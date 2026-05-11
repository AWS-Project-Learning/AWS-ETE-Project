from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from .models import InvoiceStatus


class InvoiceCreate(BaseModel):
    order_id:      str
    customer_name: str
    email:         str
    subtotal:      float
    tax:           float
    total:         float


class InvoicePaymentUpdate(BaseModel):
    status: InvoiceStatus


class InvoiceResponse(BaseModel):
    id:            str
    order_id:      str
    customer_name: str
    email:         str
    subtotal:      float
    tax:           float
    total:         float
    status:        InvoiceStatus
    issued_at:     datetime
    due_at:        Optional[datetime]
    paid_at:       Optional[datetime]
    updated_at:    datetime

    class Config:
        from_attributes = True
