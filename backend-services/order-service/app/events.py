"""
Event publishing — order-service → SNS.

Design notes
------------
* Fire-and-forget: this module never raises. A failed publish must not roll
  back the database commit that produced the event, and a flaky SNS must not
  fail the customer's order. All errors are logged for ops visibility.
* Channel mapping: callers pass a logical channel name (e.g. "order.created"),
  which is looked up in `_CHANNEL_TO_TOPIC_ENV` to find the SNS topic ARN env
  var. This keeps callers free of AWS specifics.
* Lazy boto3 client: created on first use and cached. Avoids hard-failing the
  service at startup if AWS isn't configured (useful in local dev).
"""

import json
import logging
import os
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

# Channel → environment-variable name that holds the SNS topic ARN.
# Add new channels here as new event types are introduced.
_CHANNEL_TO_TOPIC_ENV = {
    "order.created":        "ORDER_CREATED_TOPIC_ARN",
    "order.status_updated": "ORDER_STATUS_UPDATED_TOPIC_ARN",
}

_sns_client = None  # lazy-initialised cache


def _get_client():
    """Return a cached boto3 SNS client, or None if AWS isn't configured."""
    global _sns_client
    if _sns_client is not None:
        return _sns_client
    try:
        _sns_client = boto3.client("sns")
        return _sns_client
    except Exception as e:
        # Most common cause: AWS_REGION / credentials missing in local dev.
        logger.warning(f"SNS client unavailable — events will be dropped: {e}")
        return None


def publish(channel: str, payload: dict) -> None:
    """Publish an event to the SNS topic mapped from `channel`.

    Silently drops the event (with a log line) if:
      - the channel has no topic mapping, or
      - the topic ARN env var isn't set, or
      - the SNS publish itself fails.
    """
    topic_env = _CHANNEL_TO_TOPIC_ENV.get(channel)
    if not topic_env:
        logger.info(f"channel '{channel}' has no SNS topic mapping — skipping")
        return

    topic_arn: Optional[str] = os.environ.get(topic_env)
    if not topic_arn:
        logger.warning(f"env var {topic_env} not set — '{channel}' event dropped")
        return

    sns = _get_client()
    if sns is None:
        return

    try:
        resp = sns.publish(
            TopicArn = topic_arn,
            Message  = json.dumps(payload),
            Subject  = channel,  # surfaced in SNS console + email subscriptions
        )
        logger.info(
            f"published '{channel}' for order={payload.get('order_id')} "
            f"sns_msg_id={resp.get('MessageId')}"
        )
    except (ClientError, BotoCoreError) as e:
        logger.warning(f"SNS publish failed for '{channel}': {e}")
    except Exception as e:
        logger.warning(f"unexpected error publishing '{channel}': {e}")
