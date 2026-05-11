from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from .database import Base


class OrderStatus(str, enum.Enum):
    pending    = "Pending"
    processing = "Processing"
    shipped    = "Shipped"
    delivered  = "Delivered"
    cancelled  = "Cancelled"


class PaymentStatus(str, enum.Enum):
    unpaid   = "Unpaid"
    paid     = "Paid"
    refunded = "Refunded"


class Order(Base):
    __tablename__ = "orders"

    id             = Column(String(36), primary_key=True, default=lambda: f"ORD-{uuid.uuid4().hex[:6].upper()}")
    customer_name  = Column(String(255), nullable=False)
    email          = Column(String(255), nullable=False)
    address        = Column(String(500), nullable=True)
    status         = Column(Enum(OrderStatus), default=OrderStatus.pending, nullable=False)
    payment_status = Column(Enum(PaymentStatus), default=PaymentStatus.unpaid, nullable=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id           = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id     = Column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_name = Column(String(255), nullable=False)
    quantity     = Column(Integer, nullable=False)
    unit_price   = Column(Float, nullable=False)

    order = relationship("Order", back_populates="items")

    @property
    def total(self):
        return round(self.quantity * self.unit_price, 2)
