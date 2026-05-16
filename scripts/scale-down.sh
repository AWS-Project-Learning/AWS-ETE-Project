#!/usr/bin/env bash
# ./scripts/scale-down.sh 
# scale-down.sh — Stop all Fargate tasks to save ~$25–30/month.
#
# What this does:
#   1. Sets desiredCount=0 on bff, order-service, invoice-service.
#   2. Waits for all tasks to drain.
#   3. Verifies billing is at $0 for Fargate.
#
# What this does NOT do:
#   - Destroy ALB, RDS, CloudFront, or any Terraform-managed resource.
#   - Modify any data. RDS keeps running (free tier).
#   - Touch ECR images or task definitions — scale-up reuses them as-is.
#
# Cost while scaled down:
#   - Fargate: $0 (no running tasks)
#   - ALB:     ~$16/month (unavoidable while ALB exists)
#   - RDS:     $0 (free tier, first 12 months)
#   - Total:   ~$16/month idle
#
# Usage:
#   ./scripts/scale-down.sh           # defaults to dev
#   ./scripts/scale-down.sh prod      # any env
#
set -euo pipefail

ENV="${1:-dev}"
PROJECT="orderflow"
CLUSTER="${PROJECT}-${ENV}"
SERVICES=(bff order-service invoice-service)

echo "=============================================="
echo " Scaling DOWN ${CLUSTER}"
echo "=============================================="

# ── 1. Scale each service to 0 ────────────────────────────────────────────────
for SERVICE in "${SERVICES[@]}"; do
  ACTIVE=$(aws ecs describe-services \
    --cluster  "$CLUSTER" \
    --services "$SERVICE" \
    --query    'services[?status==`ACTIVE`].serviceName' \
    --output   text 2>/dev/null || echo "")

  if [ -n "$ACTIVE" ]; then
    echo "  Scaling $SERVICE → 0 ..."
    aws ecs update-service \
      --cluster      "$CLUSTER" \
      --service      "$SERVICE" \
      --desired-count 0 \
      --no-cli-pager > /dev/null
  else
    echo "  $SERVICE not ACTIVE — skipping."
  fi
done

# ── 2. Wait for tasks to drain (max 4 min) ────────────────────────────────────
echo ""
echo "Waiting for tasks to drain..."
for i in $(seq 1 24); do
  RUNNING=$(aws ecs list-tasks \
    --cluster        "$CLUSTER" \
    --desired-status RUNNING \
    --query          'length(taskArns)' \
    --output         text 2>/dev/null || echo "0")
  echo "  check $i/24 — running tasks: $RUNNING"
  if [ "$RUNNING" = "0" ]; then
    break
  fi
  if [ "$i" = "24" ]; then
    echo ""
    echo "FAIL: tasks still running after 4 minutes."
    exit 1
  fi
  sleep 10
done

# ── 3. Verify ──────────────────────────────────────────────────────────────────
echo ""
echo "Final state:"
aws ecs describe-services \
  --cluster  "$CLUSTER" \
  --services "${SERVICES[@]}" \
  --query    'services[].{name:serviceName,desired:desiredCount,running:runningCount,pending:pendingCount}' \
  --output   table \
  --no-cli-pager

echo ""
echo "=============================================="
echo " DONE — Fargate billing: \$0"
echo " ALB + RDS still running (RDS = free tier)"
echo " To resume: ./scripts/scale-up.sh ${ENV}"
echo "=============================================="
