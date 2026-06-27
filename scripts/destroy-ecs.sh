#!/usr/bin/env bash
# destroy-ecs.sh — Pre-terraform destroy cleanup for OrderFlow deploy resources.
#
# What this does:
#   1. Scales ECS services to 0, drains tasks, deletes services.
#   2. Deletes Cloud Map service entries (deploy/apply.py — blocks namespace destroy).
#   3. Empties ECR repos and the versioned frontend S3 bucket (blocks TF destroy).
#
# Run before `terraform destroy`. The infra.yml destroy job calls this first,
# then generates a fresh destroy plan (so force_delete / force_destroy apply).
#
# Usage:
#   ./scripts/destroy-ecs.sh           # defaults to dev
#   ./scripts/destroy-ecs.sh prod
#
set -euo pipefail

ENV="${1:-dev}"
PROJECT="orderflow"
CLUSTER="${PROJECT}-${ENV}"
SERVICES=(bff order-service invoice-service)

echo "=============================================="
echo " Pre-destroy cleanup — ${PROJECT} / ${ENV}"
echo "=============================================="

# ── 1. Scale each ECS service to 0 ────────────────────────────────────────────
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
echo "Waiting for Fargate tasks to drain..."
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
    echo "FAIL: tasks still running after 4 minutes."
    exit 1
  fi
  sleep 10
done

# ── 3. Delete ECS services ────────────────────────────────────────────────────
echo ""
for SERVICE in "${SERVICES[@]}"; do
  ACTIVE=$(aws ecs describe-services \
    --cluster  "$CLUSTER" \
    --services "$SERVICE" \
    --query    'services[?status==`ACTIVE`].serviceName' \
    --output   text 2>/dev/null || echo "")

  if [ -n "$ACTIVE" ]; then
    echo "  Deleting ECS service $SERVICE ..."
    aws ecs delete-service \
      --cluster  "$CLUSTER" \
      --service  "$SERVICE" \
      --force \
      --no-cli-pager > /dev/null
    echo "  Deleted $SERVICE."
  else
    echo "  $SERVICE not found / not active — skipping."
  fi
done

# ── 4. Delete Cloud Map services ──────────────────────────────────────────────
echo ""
NS_ID=$(aws ssm get-parameter \
  --name   "/orderflow/${ENV}/infra/cloudmap-namespace-id" \
  --query  'Parameter.Value' \
  --output text 2>/dev/null || echo "")

if [ -z "$NS_ID" ] || [ "$NS_ID" = "None" ]; then
  NS_ID=$(aws servicediscovery list-namespaces \
    --query "Namespaces[?Name=='${PROJECT}-${ENV}.local'].Id | [0]" \
    --output text 2>/dev/null || echo "")
  if [ -n "$NS_ID" ] && [ "$NS_ID" != "None" ]; then
    echo "Cloud Map namespace from SSM missing — resolved by name: ${NS_ID}"
  fi
fi

if [ -n "$NS_ID" ] && [ "$NS_ID" != "None" ]; then
  echo "Deleting Cloud Map services in namespace ${NS_ID} ..."
  CM_IDS=$(aws servicediscovery list-services \
    --filters "Name=NAMESPACE_ID,Values=${NS_ID}" \
    --query   'Services[].Id' \
    --output  text 2>/dev/null || echo "")

  if [ -z "$CM_IDS" ]; then
    echo "  No Cloud Map services found."
  else
    for SID in $CM_IDS; do
      NAME=$(aws servicediscovery get-service \
        --id "$SID" --query 'Service.Name' --output text 2>/dev/null || echo "$SID")
      echo "  Deleting Cloud Map service ${NAME} (${SID}) ..."
      aws servicediscovery delete-service --id "$SID" --no-cli-pager > /dev/null
    done
  fi
else
  echo "WARN: Cloud Map namespace not found — TF may fail on namespace destroy."
fi

# ── 5. Empty ECR repositories ─────────────────────────────────────────────────
echo ""
echo "Emptying ECR repositories ..."
for SERVICE in "${SERVICES[@]}"; do
  REPO="${PROJECT}/${SERVICE}"
  if ! aws ecr describe-repositories --repository-names "$REPO" --no-cli-pager &>/dev/null; then
    echo "  $REPO — not found, skipping."
    continue
  fi
  echo "  Purging images in $REPO ..."
  while true; do
    IMAGE_IDS=$(aws ecr list-images --repository-name "$REPO" --max-items 100 \
      --query 'imageIds' --output json 2>/dev/null || echo "[]")
    [ "$IMAGE_IDS" = "[]" ] && break
    aws ecr batch-delete-image --repository-name "$REPO" \
      --image-ids "$IMAGE_IDS" --no-cli-pager > /dev/null
  done
  echo "  OK  : $REPO empty"
done

# ── 6. Empty frontend S3 bucket (versioned objects block delete) ─────────────
echo ""
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${PROJECT}-frontend-${ENV}-${ACCOUNT}"
echo "Emptying S3 bucket s3://${BUCKET} ..."
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3 rm "s3://${BUCKET}" --recursive --no-cli-pager > /dev/null || true
  # Remove all versioned objects and delete markers
  while true; do
    RESP=$(aws s3api list-object-versions --bucket "$BUCKET" \
      --max-keys 1000 --output json 2>/dev/null || echo '{}')
    VCOUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('Versions',[]))+len(d.get('DeleteMarkers',[])))")
    [ "${VCOUNT:-0}" = "0" ] && break
    echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
objs = [{'Key': v['Key'], 'VersionId': v['VersionId']} for v in d.get('Versions', [])]
objs += [{'Key': v['Key'], 'VersionId': v['VersionId']} for v in d.get('DeleteMarkers', [])]
if objs:
    json.dump({'Objects': objs, 'Quiet': True}, sys.stdout)
" > /tmp/s3-delete.json
    [ ! -s /tmp/s3-delete.json ] && break
    aws s3api delete-objects --bucket "$BUCKET" --delete "file:///tmp/s3-delete.json" --no-cli-pager > /dev/null
  done
  echo "  OK  : bucket emptied"
else
  echo "  Bucket not found — skipping."
fi

# ── 7. Verify ECS ─────────────────────────────────────────────────────────────
echo ""
echo "Verifying ECS teardown..."
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
  echo "FAIL: $ERRORS ECS check(s) failed."
  exit 1
fi

echo ""
echo "=============================================="
echo " DONE — pre-destroy cleanup complete"
echo " Next: terraform plan -destroy && terraform apply"
echo "=============================================="
