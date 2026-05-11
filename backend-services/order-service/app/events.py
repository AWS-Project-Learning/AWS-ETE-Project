import json
import logging
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
    """Publish an event to a Redis channel. Fails silently if Redis is unavailable."""
    client = get_redis_client()
    if client is None:
        logger.warning(f"Skipping event publish to '{channel}' — Redis unavailable")
        return
    try:
        client.publish(channel, json.dumps(payload))
        logger.info(f"Published event to '{channel}': {payload}")
    except Exception as e:
        logger.warning(f"Failed to publish event to '{channel}': {e}")
