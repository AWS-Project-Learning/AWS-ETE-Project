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

    paginator = sd_client.get_paginator("list_services")
    for page in paginator.paginate(Filters=[{"Name": "NAMESPACE_ID", "Values": [namespace_id]}]):
        for svc in page["Services"]:
            if svc["Name"] == name:
                print(f"[cloudmap] Already exists: {svc['Arn']}")
                return svc["Id"], svc["Arn"]

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

def deploy_ecs_service(ecs_client, ecs_svc_doc: dict, task_def_arn: str, sd_arn: str | None):
    cluster      = ecs_svc_doc["cluster"]
    service_name = ecs_svc_doc["serviceName"]

    # Resolve Cloud Map placeholder (_cloudmap_name) → real registryArn at apply time
    service_registries = []
    for r in ecs_svc_doc.get("serviceRegistries", []):
        if "_cloudmap_name" in r and sd_arn:
            service_registries.append({
                "registryArn":   sd_arn,
                "containerName": r["containerName"],
                "containerPort": r["containerPort"]
            })
        elif "registryArn" in r:
            service_registries.append(r)

    print(f"[ecs] Service: {service_name} in cluster: {cluster}")
    resp     = ecs_client.describe_services(cluster=cluster, services=[service_name])
    existing = [s for s in resp["services"] if s["status"] != "INACTIVE"]

    if existing:
        print(f"[ecs] Updating existing service.")
        ecs_client.update_service(
            cluster=cluster,
            service=service_name,
            taskDefinition=task_def_arn,
            desiredCount=ecs_svc_doc["desiredCount"],
            deploymentConfiguration=ecs_svc_doc.get("deploymentConfiguration", {}),
            healthCheckGracePeriodSeconds=ecs_svc_doc.get("healthCheckGracePeriodSeconds", 0),
            forceNewDeployment=True
        )
        print(f"[ecs] Updated — new deployment started.")
    else:
        print(f"[ecs] Creating new service.")
        create_kwargs = {
            "cluster":                       cluster,
            "serviceName":                   service_name,
            "taskDefinition":                task_def_arn,
            "desiredCount":                  ecs_svc_doc["desiredCount"],
            "launchType":                    "EC2",
            "deploymentConfiguration":       ecs_svc_doc.get("deploymentConfiguration", {}),
            "healthCheckGracePeriodSeconds": ecs_svc_doc.get("healthCheckGracePeriodSeconds", 0),
            "enableECSManagedTags":          True,
            "propagateTags":                 "SERVICE",
            "tags":                          ecs_svc_doc.get("tags", [])
        }
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
