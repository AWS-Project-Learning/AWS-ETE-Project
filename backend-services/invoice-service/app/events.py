import json
import logging
import threading
from .config import settings

logger = logging.getLogger(__name__)


def get_redis_client():
    try:
        import redis
        return redis.from_url(settings.REDIS_URL, decode_responses=True)
    except Exception as e:
        logger.warning(f"Redis not available: {e}")
        return None


def publish(channel: str, payload: dict):
    """Publish an event. Fails silently if Redis is unavailable."""
    client = get_redis_client()
    if not client:
        return
    try:
        client.publish(channel, json.dumps(payload))
        logger.info(f"Published to '{channel}': {payload}")
    except Exception as e:
        logger.warning(f"Failed to publish to '{channel}': {e}")


def start_listener():
    """Start Redis subscriber in a background thread. Handles order events."""
    thread = threading.Thread(target=_listen, daemon=True)
    thread.start()
    logger.info("Redis listener thread started")


def _listen():
    client = get_redis_client()
    if not client:
        logger.warning("Redis unavailable — listener not started")
        return

    pubsub = client.pubsub()
    pubsub.subscribe("order.created", "order.status_updated")
    logger.info("Subscribed to: order.created, order.status_updated")

    for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            data    = json.loads(message["data"])
            channel = message["channel"]
            logger.info(f"Received event on '{channel}': {data}")
            _handle(channel, data)
        except Exception as e:
            logger.error(f"Error handling message: {e}")


def _handle(channel: str, data: dict):
    # Import here to avoid circular imports at module load time
    from .database import SessionLocal
    from .models import Invoice, InvoiceStatus
    from datetime import datetime, timedelta

    db = SessionLocal()
    try:
        if channel == "order.created":
            # Auto-create invoice when a new order arrives
            existing = db.query(Invoice).filter(Invoice.order_id == data["order_id"]).first()
            if existing:
                return

            subtotal = round(data["total"] / 1.10, 2)
            tax      = round(data["total"] - subtotal, 2)
            due      = datetime.utcnow() + timedelta(days=14)

            invoice = Invoice(
                order_id=data["order_id"],
                customer_name=data["customer_name"],
                email=data["email"],
                subtotal=subtotal,
                tax=tax,
                total=data["total"],
                due_at=due,
            )
            db.add(invoice)
            db.commit()
            logger.info(f"Auto-created invoice for order {data['order_id']}")

        elif channel == "order.status_updated":
            # If order is cancelled, mark related invoice as refunded
            if data.get("status") == "Cancelled":
                invoice = db.query(Invoice).filter(Invoice.order_id == data["order_id"]).first()
                if invoice and invoice.status != InvoiceStatus.refunded:
                    invoice.status = InvoiceStatus.refunded
                    db.commit()
                    publish("invoice.refunded", {
                        "invoice_id": invoice.id,
                        "order_id":   invoice.order_id,
                        "email":      invoice.email,
                    })
                    logger.info(f"Marked invoice {invoice.id} as refunded (order cancelled)")
    finally:
        db.close()
