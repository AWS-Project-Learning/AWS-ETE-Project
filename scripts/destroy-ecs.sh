#!/usr/bin/env bash
# destroy-ecs.sh — Drain and delete all OrderFlow ECS services on a cluster.
#
# What this does:
#   1. Sets desiredCount=0 on bff, order-service, invoice-service.
#   2. Waits for all Fargate tasks to drain.
#   3. Deletes each ECS service (--force).
#   4. Deletes Cloud Map service entries (created by deploy/apply.py).
#   5. Verifies no running tasks remain.
#
# What this does NOT do:
#   - Destroy ALB, RDS, VPC, CloudFront, Lambda, or any Terraform resource.
#   - Remove ECR images or task definitions.
#
# Use before a full `terraform destroy` so subnets/VPC teardown is not blocked
# by active ENIs from running tasks. The infra.yml destroy job runs this first.
#
# Usage:
#   ./scripts/destroy-ecs.sh           # defaults to dev
#   ./scripts/destroy-ecs.sh prod      # any env
#
set -euo pipefail

ENV="${1:-dev}"
PROJECT="orderflow"
CLUSTER="${PROJECT}-${ENV}"
SERVICES=(bff order-service invoice-service)

echo "=============================================="
echo " Destroying ECS services on ${CLUSTER}"
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
      --cluster       "$CLUSTER" \
      --service       "$SERVICE" \
      --desired-count 0 \
      --no-cli-pager > /dev/null
  else
    echo "  $SERVICE not ACTIVE — skipping scale-down."
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
    echo "  All tasks drained."
    break
  fi
  if [ "$i" = "24" ]; then
    echo ""
    echo "FAIL: tasks still running after 4 minutes."
    exit 1
  fi
  sleep 10
done

# ── 3. Delete each service ────────────────────────────────────────────────────
echo ""
for SERVICE in "${SERVICES[@]}"; do
  ACTIVE=$(aws ecs describe-services \
    --cluster  "$CLUSTER" \
    --services "$SERVICE" \
    --query    'services[?status==`ACTIVE`].serviceName' \
    --output   text 2>/dev/null || echo "")

  if [ -n "$ACTIVE" ]; then
    echo "  Deleting service $SERVICE ..."
    aws ecs delete-service \
      --cluster  "$CLUSTER" \
      --service  "$SERVICE" \
      --force \
      --no-cli-pager > /dev/null
    echo "  Deleted $SERVICE."
  else
    echo "  $SERVICE not found / not active — skipping delete."
  fi
done

# ── 4. Delete Cloud Map services (deploy pipeline, not Terraform) ─────────────
echo ""
NS_ID=$(aws ssm get-parameter \
  --name   "/orderflow/${ENV}/infra/cloudmap-namespace-id" \
  --query  'Parameter.Value' \
  --output text 2>/dev/null || echo "")

if [ -n "$NS_ID" ] && [ "$NS_ID" != "None" ]; then
  echo "Deleting Cloud Map services in namespace ${NS_ID} ..."
  CM_IDS=$(aws servicediscovery list-services \
    --filters "Name=NAMESPACE_ID,Values=${NS_ID}" \
    --query   'Services[].Id' \
    --output  text 2>/dev/null || echo "")

  if [ -z "$CM_IDS" ]; then
    echo "  No Cloud Map services found — skipping."
  else
    for SID in $CM_IDS; do
      NAME=$(aws servicediscovery get-service \
        --id "$SID" --query 'Service.Name' --output text 2>/dev/null || echo "$SID")
      echo "  Deleting Cloud Map service ${NAME} (${SID}) ..."
      aws servicediscovery delete-service --id "$SID" --no-cli-pager > /dev/null
    done
  fi
else
  echo "Cloud Map namespace id not in SSM — skipping service cleanup."
fi

# ── 5. Verify ─────────────────────────────────────────────────────────────────
echo ""
echo "Verifying teardown..."
ERRORS=0

RUNNING=$(aws ecs list-tasks \
  --cluster        "$CLUSTER" \
  --desired-status RUNNING \
  --query          'length(taskArns)' \
  --output         text 2>/dev/null || echo "0")
if [ "$RUNNING" != "0" ]; then
  echo "  FAIL: $RUNNING Fargate task(s) still running"
  ERRORS=$((ERRORS + 1))
else
  echo "  OK  : No Fargate tasks running"
fi

for SERVICE in "${SERVICES[@]}"; do
  ACTIVE=$(aws ecs describe-services \
    --cluster  "$CLUSTER" \
    --services "$SERVICE" \
    --query    'services[?status==`ACTIVE`].serviceName' \
    --output   text 2>/dev/null || echo "")
  if [ -n "$ACTIVE" ]; then
    echo "  FAIL: $SERVICE is still ACTIVE"
    ERRORS=$((ERRORS + 1))
  else
    echo "  OK  : $SERVICE removed or inactive"
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAIL: $ERRORS check(s) failed — ECS services may still exist."
  exit 1
fi

echo ""
echo "=============================================="
echo " DONE — ECS services destroyed on ${CLUSTER}"
echo " ECS cluster ${CLUSTER} is preserved (Terraform-managed)."
echo " Next: run terraform destroy (infra.yml action=destroy)"
echo "=============================================="
