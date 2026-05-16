#!/usr/bin/env bash
# ./scripts/scale-up.sh  
# scale-up.sh — Restart Fargate tasks after a scale-down.
#
# What this does:
#   1. Sets desiredCount=1 on bff, order-service, invoice-service.
#   2. Waits for all services to reach steady state (tasks RUNNING + healthy).
#   3. Probes the public URL to confirm /api/* is back online.
#
# Assumes:
#   - ALB, RDS, ECS cluster, and Cloud Map already exist (scale-down doesn't
#     destroy them).
#   - Task definitions are intact (we never deleted them).
#
# Usage:
#   ./scripts/scale-up.sh           # defaults to dev
#   ./scripts/scale-up.sh prod      # any env
#
set -euo pipefail

ENV="${1:-dev}"
PROJECT="orderflow"
CLUSTER="${PROJECT}-${ENV}"
SERVICES=(bff order-service invoice-service)

echo "=============================================="
echo " Scaling UP ${CLUSTER}"
echo "=============================================="

# ── 1. Scale each service back to 1 ───────────────────────────────────────────
for SERVICE in "${SERVICES[@]}"; do
  ACTIVE=$(aws ecs describe-services \
    --cluster  "$CLUSTER" \
    --services "$SERVICE" \
    --query    'services[?status==`ACTIVE`].serviceName' \
    --output   text 2>/dev/null || echo "")

  if [ -n "$ACTIVE" ]; then
    echo "  Scaling $SERVICE → 1 ..."
    aws ecs update-service \
      --cluster      "$CLUSTER" \
      --service      "$SERVICE" \
      --desired-count 1 \
      --no-cli-pager > /dev/null
  else
    echo "  FAIL: $SERVICE is not ACTIVE (status missing)."
    echo "        It may have been deleted — redeploy via the deploy pipeline."
    exit 1
  fi
done

# ── 2. Wait for services to stabilize (max ~10 min each) ──────────────────────
echo ""
echo "Waiting for services to stabilize (this can take 1–3 minutes)..."
aws ecs wait services-stable \
  --cluster  "$CLUSTER" \
  --services "${SERVICES[@]}"

echo ""
echo "Final state:"
aws ecs describe-services \
  --cluster  "$CLUSTER" \
  --services "${SERVICES[@]}" \
  --query    'services[].{name:serviceName,desired:desiredCount,running:runningCount}' \
  --output   table \
  --no-cli-pager

# ── 3. Probe the public URL ────────────────────────────────────────────────────
CF_ID=$(aws ssm get-parameter \
  --name   "/orderflow/${ENV}/infra/cloudfront-id" \
  --query  'Parameter.Value' \
  --output text 2>/dev/null || echo "")

if [ -n "$CF_ID" ]; then
  CF_DOMAIN=$(aws cloudfront get-distribution \
    --id    "$CF_ID" \
    --query 'Distribution.DomainName' \
    --output text 2>/dev/null || echo "")

  if [ -n "$CF_DOMAIN" ]; then
    echo ""
    echo "Probing https://${CF_DOMAIN}/api/orders ..."
    for i in 1 2 3 4 5; do
      CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${CF_DOMAIN}/api/orders" || echo "000")
      echo "  attempt $i/5 — HTTP $CODE"
      if [ "$CODE" = "200" ]; then
        break
      fi
      sleep 10
    done

    echo ""
    if [ "$CODE" = "200" ]; then
      echo "API is responding 200 — platform is live."
    else
      echo "WARN: API not yet returning 200 (last code: $CODE)."
      echo "      Targets may still be registering with the ALB — wait 30–60s."
    fi
    echo ""
    echo "UI: https://${CF_DOMAIN}/"
  fi
fi

echo ""
echo "=============================================="
echo " DONE — services back online"
echo " To stop again: ./scripts/scale-down.sh ${ENV}"
echo "=============================================="
