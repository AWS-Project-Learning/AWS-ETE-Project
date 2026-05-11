from sqlalchemy import Column, String, Float, DateTime, Enum
from sqlalchemy.sql import func
import uuid
import enum
from .database import Base


class InvoiceStatus(str, enum.Enum):
    unpaid   = "Unpaid"
    paid     = "Paid"
    overdue  = "Overdue"
    refunded = "Refunded"


class Invoice(Base):
    __tablename__ = "invoices"

    id             = Column(String(36),  primary_key=True, default=lambda: f"INV-{uuid.uuid4().hex[:6].upper()}")
    order_id       = Column(String(36),  nullable=False, index=True)
    customer_name  = Column(String(255), nullable=False)
    email          = Column(String(255), nullable=False)
    subtotal       = Column(Float,       nullable=False)
    tax            = Column(Float,       nullable=False)
    total          = Column(Float,       nullable=False)
    status         = Column(Enum(InvoiceStatus), default=InvoiceStatus.unpaid, nullable=False)
    issued_at      = Column(DateTime(timezone=True), server_default=func.now())
    due_at         = Column(DateTime(timezone=True), nullable=True)
    paid_at        = Column(DateTime(timezone=True), nullable=True)
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
