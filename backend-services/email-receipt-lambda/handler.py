"""
Email Receipt Lambda
====================
Subscribed to TWO SNS topics:
  - order-created          → "Order Confirmation" email (always)
  - order-status-updated   → status-change email (only for meaningful changes)

The SNS Subject carries the channel name (set by order-service's
events.publish call). The handler dispatches on it to pick the right
template, and to filter out noisy intermediate statuses like Pending and
Processing — those are internal lifecycle steps the customer doesn't care
about.

Trigger payload (SNS pushes this to Lambda):
    {
      "Records": [{
        "EventSource": "aws:sns",
        "Sns": {
          "Subject": "order.created"   |   "order.status_updated",
          "Message": "{\"order_id\": \"...\", \"customer_name\": \"...\", ...}"
        }
      }]
    }

Environment variables (set by Terraform in infra/email.tf):
    SENDER_EMAIL  — verified SES sender address (e.g. kannanks.smart@gmail.com)
    LOG_LEVEL     — INFO | DEBUG (defaults to INFO)

Failure handling:
    - One bad record does NOT stop other records being processed.
    - Repeated failures eventually trigger SNS retry policy (3 attempts).
    - Without a DLQ configured, the message is dropped after retries — fine for
      a personal project, add `aws_sqs_queue` + dead_letter_config later for prod.

Cost: practically free.
    Lambda free tier covers 1M invocations + 400K GB-seconds/month forever.
    SES free tier covers 62K emails/month from Lambda forever.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

# ── Setup ─────────────────────────────────────────────────────────────────────

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# Single boto3 client created at cold-start, reused across warm invocations.
# Lambda recycles the container after ~5–15 min of idle, so this is rebuilt then.
_ses = boto3.client("ses", region_name=os.environ.get("AWS_REGION", "us-east-1"))

SENDER = os.environ["SENDER_EMAIL"]

# Statuses worth emailing about. Internal/intermediate states are noise from
# the customer's point of view — we drop them before any SES call.
_NOTIFIABLE_STATUSES = {"Shipped", "Delivered", "Cancelled"}


# ── Entry point ───────────────────────────────────────────────────────────────

def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """SNS → Lambda entry point. Processes each Record independently."""
    records = event.get("Records", [])
    logger.info("received %d record(s)", len(records))

    sent, skipped, failed = 0, 0, 0
    for record in records:
        try:
            sns      = record["Sns"]
            channel  = sns.get("Subject") or "unknown"
            payload  = json.loads(sns["Message"])
            result   = _dispatch(channel, payload)
            if result == "sent":     sent    += 1
            elif result == "skipped": skipped += 1
        except Exception:
            # Catch broadly so a single bad record can't block the rest.
            failed += 1
            logger.exception("failed to process record")

    logger.info("done — sent: %d, skipped: %d, failed: %d", sent, skipped, failed)
    return {"statusCode": 200, "sent": sent, "skipped": skipped, "failed": failed}


# ── Dispatcher ────────────────────────────────────────────────────────────────

def _dispatch(channel: str, payload: dict[str, Any]) -> str:
    """Decide which email (if any) to send for this event.

    Returns one of: "sent", "skipped".
    Raises on SES failure — the caller increments `failed`.
    """
    email = payload.get("email")
    if not email:
        logger.warning("event has no email — skipping (channel=%s)", channel)
        return "skipped"

    if channel == "order.created":
        _send_confirmation(payload, email)
        return "sent"

    if channel == "order.status_updated":
        status = payload.get("status", "")
        if status not in _NOTIFIABLE_STATUSES:
            # Pending / Processing — internal noise, customer doesn't care.
            logger.info("status '%s' is not notifiable — skipping (order=%s)",
                        status, payload.get("order_id", "?"))
            return "skipped"
        _send_status_change(payload, email)
        return "sent"

    logger.warning("unknown channel '%s' — skipping", channel)
    return "skipped"


# ── SES send paths ────────────────────────────────────────────────────────────

def _send_confirmation(order: dict[str, Any], email: str) -> None:
    """Order-confirmation email for newly-created orders."""
    customer = order.get("customer_name", "Customer")
    order_id = order.get("order_id", "unknown")
    total    = float(order.get("total", 0) or 0)
    status   = order.get("status", "pending")
    short_id = order_id[:8] if order_id else "?"

    subject   = f"Order Confirmation — #{short_id}"
    body_text = _render_confirmation_text(customer, short_id, total, status)
    body_html = _render_confirmation_html(customer, short_id, total, status)
    _send(email, subject, body_text, body_html, log_kind="confirmation",
          order_id=short_id)


def _send_status_change(order: dict[str, Any], email: str) -> None:
    """Status-change email for Shipped / Delivered / Cancelled."""
    order_id = order.get("order_id", "unknown")
    status   = order.get("status", "")
    short_id = order_id[:8] if order_id else "?"

    headlines = {
        "Shipped":   ("Your order is on its way",
                      "We have shipped your order. You will receive it soon."),
        "Delivered": ("Your order has been delivered",
                      "Your order has been delivered. We hope you enjoy it!"),
        "Cancelled": ("Your order was cancelled",
                      "Your order has been cancelled. Contact us if this is unexpected."),
    }
    headline, lead = headlines[status]

    subject   = f"{headline} — #{short_id}"
    body_text = f"Hi,\n\n{lead}\n\n  Order ID : {short_id}\n  Status   : {status}\n\n— OrderFlow"
    body_html = _render_status_change_html(headline, lead, short_id, status)
    _send(email, subject, body_text, body_html, log_kind=f"status:{status}",
          order_id=short_id)


def _send(to: str, subject: str, body_text: str, body_html: str,
          *, log_kind: str, order_id: str) -> None:
    """Single SES SendEmail call with consistent error logging."""
    try:
        resp = _ses.send_email(
            Source      = SENDER,
            Destination = {"ToAddresses": [to]},
            Message = {
                "Subject": {"Data": subject,   "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": body_text, "Charset": "UTF-8"},
                    "Html": {"Data": body_html, "Charset": "UTF-8"},
                },
            },
        )
        logger.info("sent %s — order=%s to=%s ses_msg_id=%s",
                    log_kind, order_id, to, resp.get("MessageId"))
    except ClientError as e:
        # Most common cause: recipient not verified while SES is in sandbox.
        # Surface the AWS error code so CloudWatch search is easy.
        code = e.response.get("Error", {}).get("Code", "Unknown")
        msg  = e.response.get("Error", {}).get("Message", str(e))
        logger.error("SES SendEmail failed (%s): %s", code, msg)
        raise


# ── Templates ─────────────────────────────────────────────────────────────────
# Kept inline so the lambda zip stays a single file with zero asset packaging.

def _render_confirmation_text(customer: str, order_id: str, total: float,
                              status: str) -> str:
    return (
        f"Hi {customer},\n\n"
        f"Thanks for your order!\n\n"
        f"  Order ID : {order_id}\n"
        f"  Total    : ${total:,.2f}\n"
        f"  Status   : {status}\n\n"
        f"You will receive another email when your order ships.\n\n"
        f"— OrderFlow"
    )


def _render_confirmation_html(customer: str, order_id: str, total: float,
                              status: str) -> str:
    return f"""<!doctype html>
<html>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f6f8; margin:0; padding:32px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <tr><td style="padding:32px 32px 8px;">
      <h1 style="margin:0; font-size:22px; color:#111827;">Order confirmed</h1>
      <p style="margin:8px 0 0; color:#6b7280; font-size:14px;">Hi {customer}, thanks for your order.</p>
    </td></tr>
    <tr><td style="padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px; color:#111827;">
        <tr><td style="padding:6px 0; color:#6b7280;">Order ID</td>
            <td style="padding:6px 0; text-align:right; font-family:monospace;">#{order_id}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Status</td>
            <td style="padding:6px 0; text-align:right; text-transform:capitalize;">{status}</td></tr>
        <tr><td style="padding:12px 0 0; color:#6b7280; border-top:1px solid #f3f4f6;">Total</td>
            <td style="padding:12px 0 0; text-align:right; font-weight:600; border-top:1px solid #f3f4f6;">${total:,.2f}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 32px 32px; color:#9ca3af; font-size:12px;">
      You will receive another email when your order ships.
    </td></tr>
  </table>
  <p style="text-align:center; color:#9ca3af; font-size:11px; margin-top:24px;">— OrderFlow</p>
</body>
</html>"""


def _render_status_change_html(headline: str, lead: str,
                               order_id: str, status: str) -> str:
    # Highlight colour shifts depending on the status — green for shipped /
    # delivered (good news), red for cancelled.
    accent = "#dc2626" if status == "Cancelled" else "#16a34a"
    return f"""<!doctype html>
<html>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f6f8; margin:0; padding:32px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <tr><td style="padding:32px 32px 8px; border-top:4px solid {accent}; border-radius:16px 16px 0 0;">
      <h1 style="margin:0; font-size:22px; color:#111827;">{headline}</h1>
      <p style="margin:8px 0 0; color:#6b7280; font-size:14px;">{lead}</p>
    </td></tr>
    <tr><td style="padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px; color:#111827;">
        <tr><td style="padding:6px 0; color:#6b7280;">Order ID</td>
            <td style="padding:6px 0; text-align:right; font-family:monospace;">#{order_id}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">New status</td>
            <td style="padding:6px 0; text-align:right; font-weight:600; color:{accent};">{status}</td></tr>
      </table>
    </td></tr>
  </table>
  <p style="text-align:center; color:#9ca3af; font-size:11px; margin-top:24px;">— OrderFlow</p>
</body>
</html>"""
