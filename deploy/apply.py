#!/usr/bin/env python3
"""
ECS Service Applier  (Phase 2 of 2)
=====================================
Reads the rendered JSON manifests from deploy/out/{service}/{env}/
and applies them to AWS idempotently.

Run render.py first, review the output files, then run this.

Usage:
    python apply.py --service bff          --env dev
    python apply.py --service order-service --env sit
"""

import argparse
import json
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

DEPLOY_DIR = Path(__file__).parent
OUT_DIR    = DEPLOY_DIR / "out"


# ── File helpers ───────────────────────────────────────────────────────────────

def read_json(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"[ERROR] Not found: {path}\n  Run render.py first.")
    with open(path) as f:
        return json.load(f)


# ── Step 1: CloudWatch log group ──────────────────────────────────────────────

def ensure_log_group(logs_client, log_group: str):
    print(f"[log group] {log_group}")
    try:
        logs_client.create_log_group(logGroupName=log_group)
        logs_client.put_retention_policy(logGroupName=log_group, retentionInDays=7)
        print(f"[log group] Created.")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
            print(f"[log group] Already exists — skipping.")
        else:
            raise


# ── Step 2: IAM task role ─────────────────────────────────────────────────────

def ensure_iam_role(iam_client, role_name: str, trust_doc: dict, policy_doc: dict | None) -> str:
    print(f"[iam] Role: {role_name}")
    try:
        resp = iam_client.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(trust_doc),
            Description=f"ECS task role for {role_name}",
            Tags=[{"Key": "managed-by", "Value": "deploy-pipeline"}]
        )
        role_arn = resp["Role"]["Arn"]
        print(f"[iam] Created: {role_arn}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "EntityAlreadyExists":
            role_arn = iam_client.get_role(RoleName=role_name)["Role"]["Arn"]
            print(f"[iam] Already exists: {role_arn}")
        else:
            raise

    if policy_doc:
        policy_name = f"{role_name}-policy"
        iam_client.put_role_policy(
            RoleName=role_name,
            PolicyName=policy_name,
            PolicyDocument=json.dumps(policy_doc)
        )
        print(f"[iam] Inline policy applied: {policy_name}")

    return role_arn


# ── Step 3: Cloud Map service entry ───────────────────────────────────────────

def ensure_cloudmap(sd_client, cloudmap_doc: dict | None) -> tuple[str, str] | None:
    if not cloudmap_doc:
        return None

    name         = cloudmap_doc["Name"]
    namespace_id = cloudmap_doc["NamespaceId"]
    print(f"[cloudmap] {name} (namespace: {namespace_id})")

    wanted_type = cloudmap_doc["DnsConfig"]["DnsRecords"][0]["Type"]

    paginator = sd_client.get_paginator("list_services")
    for page in paginator.paginate(Filters=[{"Name": "NAMESPACE_ID", "Values": [namespace_id]}]):
        for svc in page["Services"]:
            if svc["Name"] == name:
                # Check if the existing service has the right DNS record type.
                # A→SRV migration requires delete+recreate (AWS does not allow in-place change).
                detail      = sd_client.get_service(Id=svc["Id"])["Service"]
                actual_type = detail["DnsConfig"]["DnsRecords"][0]["Type"]
                if actual_type == wanted_type:
                    print(f"[cloudmap] Already exists: {svc['Arn']}")
                    return svc["Id"], svc["Arn"]
                else:
                    print(f"[cloudmap] Existing service has DNS type '{actual_type}', wanted '{wanted_type}' — recreating.")
                    sd_client.delete_service(Id=svc["Id"])
                    print(f"[cloudmap] Deleted stale service: {svc['Id']}")

    resp   = sd_client.create_service(
        Name=name,
        DnsConfig=cloudmap_doc["DnsConfig"],
        HealthCheckCustomConfig=cloudmap_doc["HealthCheckCustomConfig"],
        Tags=cloudmap_doc["Tags"]
    )
    sd_id  = resp["Service"]["Id"]
    sd_arn = resp["Service"]["Arn"]
    print(f"[cloudmap] Created: {sd_arn}")
    return sd_id, sd_arn


# ── Step 4: ECS task definition ───────────────────────────────────────────────

def register_task_def(ecs_client, task_def_doc: dict) -> str:
    family = task_def_doc["family"]
    print(f"[task-def] Registering: {family}")
    resp     = ecs_client.register_task_definition(**task_def_doc)
    td       = resp["taskDefinition"]
    revision = td["revision"]
    arn      = td["taskDefinitionArn"]
    print(f"[task-def] Registered: {family}:{revision}")
    return arn


# ── Step 5: ECS service ───────────────────────────────────────────────────────
#
# An ECS service is a stateful resource with a small state machine:
#
#     (none) ──create─▶ ACTIVE ──delete─▶ DRAINING ──(auto)─▶ INACTIVE ──(~1h)─▶ (none)
#                          ▲                                        │
#                          └──────────  create  ◀───────────────────┘
#
# Operations and which states accept them:
#     create_service  : valid only when "doesn't exist" (or INACTIVE tombstone)
#     update_service  : valid ONLY in ACTIVE — fails on DRAINING with
#                       ServiceNotActiveException
#     delete_service  : valid in ACTIVE; idempotent on DRAINING/INACTIVE
#
# Naïve "exists vs doesn't exist" logic is incorrect because:
#   - DRAINING means "exists but mid-deletion" — neither update nor create is safe
#   - INACTIVE means "tombstone, logically gone" — describe still returns it for
#     ~1 hour, but create_service will succeed (treating it as a recreate)
#
# We therefore explicitly resolve the current state and dispatch on it.


SERVICE_STATE_POLL_SECONDS = 10
SERVICE_STATE_MAX_WAIT_SECONDS = 180  # ~3 min — typical DRAINING completes in <60s


def resolve_service_state(ecs_client, cluster: str, service_name: str) -> str:
    """
    Return one of: ACTIVE | INACTIVE | NOT_FOUND.

    If the service is found in DRAINING state, polls describe-services until it
    transitions to INACTIVE or the timeout elapses. DRAINING is intentionally
    NOT returned to callers — by the time this function returns, the service
    is guaranteed to be in a state where either create or update is valid.
    """
    deadline = time.time() + SERVICE_STATE_MAX_WAIT_SECONDS

    while True:
        resp     = ecs_client.describe_services(cluster=cluster, services=[service_name])
        services = resp.get("services", [])

        if not services:
            # Tombstone has been purged (>~1 hour since deletion) or service
            # was never created. Either way: caller should create_service.
            return "NOT_FOUND"

        status = services[0]["status"]
        if status == "ACTIVE":
            return "ACTIVE"
        if status == "INACTIVE":
            # Tombstone still visible. create_service will succeed; AWS treats
            # this as a fresh creation and the tombstone is replaced.
            return "INACTIVE"

        # status == "DRAINING" — service is mid-deletion. Neither update nor
        # create is valid until the transition completes.
        remaining = int(deadline - time.time())
        if remaining <= 0:
            sys.exit(
                f"[ecs] FAIL: Service '{service_name}' stuck in DRAINING for "
                f">{SERVICE_STATE_MAX_WAIT_SECONDS}s. To recover, run:\n"
                f"  aws ecs delete-service --cluster {cluster} "
                f"--service {service_name} --force\n"
                f"...wait until describe-services returns failures[].reason=MISSING, "
                f"then re-run this deploy."
            )
        print(f"[ecs] Service is DRAINING — waiting (timeout in {remaining}s)...")
        time.sleep(SERVICE_STATE_POLL_SECONDS)


def deploy_ecs_service(ecs_client, ecs_svc_doc: dict, task_def_arn: str, sd_arn: str | None):
    cluster      = ecs_svc_doc["cluster"]
    service_name = ecs_svc_doc["serviceName"]

    # Resolve Cloud Map placeholder (_cloudmap_name) → real registryArn at apply time.
    # awsvpc + Type A records: only registryArn needed.
    # containerName/containerPort are only for SRV records (bridge mode) — omitted here.
    service_registries = []
    for r in ecs_svc_doc.get("serviceRegistries", []):
        if "_cloudmap_name" in r and sd_arn:
            service_registries.append({"registryArn": sd_arn})
        elif "registryArn" in r:
            service_registries.append(r)

    print(f"[ecs] Service: {service_name} in cluster: {cluster}")
    state = resolve_service_state(ecs_client, cluster, service_name)
    print(f"[ecs] Current state: {state}")

    if state == "ACTIVE":
        print(f"[ecs] Updating existing service.")
        update_kwargs = {
            "cluster":                       cluster,
            "service":                       service_name,
            "taskDefinition":                task_def_arn,
            "desiredCount":                  ecs_svc_doc["desiredCount"],
            "deploymentConfiguration":       ecs_svc_doc.get("deploymentConfiguration", {}),
            "healthCheckGracePeriodSeconds": ecs_svc_doc.get("healthCheckGracePeriodSeconds", 0),
            "forceNewDeployment":            True,
        }
        if ecs_svc_doc.get("networkConfiguration"):
            update_kwargs["networkConfiguration"] = ecs_svc_doc["networkConfiguration"]
        ecs_client.update_service(**update_kwargs)
        print(f"[ecs] Updated — new deployment started.")
        return

    # state in ("INACTIVE", "NOT_FOUND") — both mean "logically gone, safe to create".
    # INACTIVE = tombstone still visible (<1h since delete); create will replace it.
    # NOT_FOUND = no record at all; first creation or tombstone purged.
    print(f"[ecs] Creating new service.")
    create_kwargs = {
        "cluster":                       cluster,
        "serviceName":                   service_name,
        "taskDefinition":                task_def_arn,
        "desiredCount":                  ecs_svc_doc["desiredCount"],
        # launchType (FARGATE) and platformVersion (LATEST) come from the
        # rendered manifest — render.py owns the launch-type decision.
        "launchType":                    ecs_svc_doc.get("launchType", "FARGATE"),
        "deploymentConfiguration":       ecs_svc_doc.get("deploymentConfiguration", {}),
        "healthCheckGracePeriodSeconds": ecs_svc_doc.get("healthCheckGracePeriodSeconds", 0),
        "enableECSManagedTags":          True,
        "propagateTags":                 "SERVICE",
        "tags":                          ecs_svc_doc.get("tags", [])
    }
    # platformVersion is only valid for Fargate launch type.
    if create_kwargs["launchType"] == "FARGATE" and ecs_svc_doc.get("platformVersion"):
        create_kwargs["platformVersion"] = ecs_svc_doc["platformVersion"]
    if ecs_svc_doc.get("networkConfiguration"):
        create_kwargs["networkConfiguration"] = ecs_svc_doc["networkConfiguration"]
    if ecs_svc_doc.get("loadBalancers"):
        create_kwargs["loadBalancers"] = ecs_svc_doc["loadBalancers"]
    if service_registries:
        create_kwargs["serviceRegistries"] = service_registries

    ecs_client.create_service(**create_kwargs)
    print(f"[ecs] Service created.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Apply rendered ECS manifests from out/{service}/{env}/ to AWS."
    )
    parser.add_argument("--service", required=True, help="e.g. bff, order-service")
    parser.add_argument("--env",     required=True, help="dev | sit")
    args = parser.parse_args()

    service, env = args.service, args.env
    out = OUT_DIR / service / env

    print(f"\n{'='*60}")
    print(f"  Applying: {service}  |  env: {env}")
    print(f"  Source:   deploy/out/{service}/{env}/")
    print(f"{'='*60}\n")

    # Load rendered manifests
    meta       = read_json(out / "meta.json")
    iam_trust  = read_json(out / "iam-trust.json")
    iam_policy = read_json(out / "iam-policy.json") if (out / "iam-policy.json").exists() else None
    task_def   = read_json(out / "task-def.json")
    cloudmap   = read_json(out / "cloudmap.json")   if (out / "cloudmap.json").exists()   else None
    ecs_svc    = read_json(out / "ecs-service.json")

    region = meta["region"]
    ecs    = boto3.client("ecs",              region_name=region)
    iam    = boto3.client("iam",              region_name=region)
    logs   = boto3.client("logs",             region_name=region)
    sd     = boto3.client("servicediscovery", region_name=region)

    # Step 1 — CloudWatch log group
    ensure_log_group(logs, meta["log_group"])
    print()

    # Step 2 — IAM task role + inline policy
    ensure_iam_role(iam, meta["role_name"], iam_trust, iam_policy)
    print()

    # Step 3 — Cloud Map service entry
    sd_result = ensure_cloudmap(sd, cloudmap)
    sd_arn    = sd_result[1] if sd_result else None
    print()

    # Step 4 — ECS task definition
    task_def_arn = register_task_def(ecs, task_def)
    print()

    # Step 5 — ECS service (create or update)
    deploy_ecs_service(ecs, ecs_svc, task_def_arn, sd_arn)

    print(f"\n[done] {service} applied to {env}.\n")


if __name__ == "__main__":
    main()
