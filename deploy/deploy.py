#!/usr/bin/env python3
"""
ECS Service Deployer
=====================
Reads deploy/{service}/service.yaml + deploy/{service}/values-{env}.yaml
and orchestrates all per-service AWS resource creation and deployment.

Resources created/updated by this script (NOT by Terraform):
  - CloudWatch log group
  - IAM task role + inline policy  (from service.yaml iam.policies)
  - Cloud Map service entry         (from service.yaml service_discovery)
  - ECS task definition             (built from merged config)
  - ECS service                     (created or updated)

Terraform handoff via SSM (read by this script):
  /orderflow/{env}/infra/cluster-name
  /orderflow/{env}/infra/cloudmap-namespace-id
  /orderflow/{env}/infra/execution-role-arn
  /orderflow/{env}/infra/tg-{service}-arn   (ALB services only)

Usage:
    python deploy.py --service bff --env dev [--image-tag abc123]
    python deploy.py --service order-service --env sit --image-tag v1.2.3
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import boto3
import yaml
from botocore.exceptions import ClientError

DEPLOY_DIR = Path(__file__).parent


# ── Config loading ─────────────────────────────────────────────────────────────

def load_yaml(path: Path) -> dict:
    if not path.exists():
        print(f"[ERROR] File not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return yaml.safe_load(f) or {}


def deep_merge(base: dict, override: dict) -> dict:
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def resolve_placeholders(obj, ctx: dict):
    """Recursively replace {key} placeholders in strings using ctx."""
    if isinstance(obj, str):
        return obj.format(**ctx)
    if isinstance(obj, dict):
        return {k: resolve_placeholders(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list):
        return [resolve_placeholders(i, ctx) for i in obj]
    return obj


def build_config(service: str, env: str) -> dict:
    shared    = load_yaml(DEPLOY_DIR / "shared.yaml")
    svc_yaml  = load_yaml(DEPLOY_DIR / service / "service.yaml")
    env_vals  = load_yaml(DEPLOY_DIR / service / f"values-{env}.yaml")

    # Merge service.yaml + values-{env}.yaml (env wins on conflicts)
    cfg = deep_merge(svc_yaml, env_vals)

    # Flatten shared defaults into compute block
    defaults = shared.get("defaults", {})
    cfg["compute"] = deep_merge(defaults, cfg.get("compute", {}))

    # Resolve {env}, {region}, {account_id} placeholders everywhere
    placeholder_ctx = {
        "env":        env,
        "region":     shared["region"],
        "account_id": shared["account_id"],
        "project":    shared["project"],
        "service":    service,
    }
    cfg = resolve_placeholders(cfg, placeholder_ctx)

    # Attach shared globals
    cfg["_shared"]  = shared
    cfg["_env"]     = env
    cfg["_service"] = service

    return cfg


# ── SSM helpers ───────────────────────────────────────────────────────────────

def ssm_get(ssm_client, path: str) -> str:
    try:
        resp = ssm_client.get_parameter(Name=path, WithDecryption=True)
        return resp["Parameter"]["Value"]
    except ClientError as e:
        print(f"[ERROR] SSM parameter not found: {path}\n  {e}", file=sys.stderr)
        sys.exit(1)


# ── Step 1: CloudWatch log group ──────────────────────────────────────────────

def ensure_log_group(logs_client, cfg: dict):
    shared  = cfg["_shared"]
    env     = cfg["_env"]
    service = cfg["_service"]
    name    = f"/ecs/{shared['project']}/{env}/{service}"

    print(f"[log group] Ensuring {name}")
    try:
        logs_client.create_log_group(logGroupName=name)
        logs_client.put_retention_policy(logGroupName=name, retentionInDays=7)
        print(f"[log group] Created.")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
            print(f"[log group] Already exists — skipping.")
        else:
            raise
    return name


# ── Step 2: IAM task role ─────────────────────────────────────────────────────

def ensure_task_role(iam_client, cfg: dict) -> str:
    service     = cfg["_service"]
    role_name   = f"ecs-task-role-{service}"
    iam_cfg     = cfg.get("iam", {})
    policies    = iam_cfg.get("policies", [])

    trust_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ecs-tasks.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    })

    # Create role if it doesn't exist
    print(f"[iam] Ensuring role: {role_name}")
    try:
        resp = iam_client.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=trust_policy,
            Description=f"ECS task role for {service}",
            Tags=[{"Key": "Service", "Value": service}, {"Key": "managed-by", "Value": "deploy-pipeline"}]
        )
        role_arn = resp["Role"]["Arn"]
        print(f"[iam] Role created: {role_arn}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "EntityAlreadyExists":
            role_arn = iam_client.get_role(RoleName=role_name)["Role"]["Arn"]
            print(f"[iam] Role already exists: {role_arn}")
        else:
            raise

    # Build + put inline policy from service.yaml iam.policies
    if policies:
        statements = []
        for pol in policies:
            statements.append({
                "Sid":      pol["sid"],
                "Effect":   "Allow",
                "Action":   pol["actions"],
                "Resource": pol["resources"]
            })

        inline_policy = json.dumps({"Version": "2012-10-17", "Statement": statements})
        policy_name   = f"{service}-policy"

        iam_client.put_role_policy(
            RoleName=role_name,
            PolicyName=policy_name,
            PolicyDocument=inline_policy
        )
        print(f"[iam] Inline policy '{policy_name}' applied ({len(statements)} statement(s)).")

    return role_arn


# ── Step 3: Cloud Map service entry (internal services only) ──────────────────

def ensure_cloud_map_service(sd_client, ssm_client, cfg: dict) -> str | None:
    sd_cfg = cfg.get("service_discovery", {})
    if not sd_cfg:
        return None

    # ALB services skip Cloud Map registration if they have a load_balancer block
    # but no explicit service_discovery — they're reachable via ALB, not DNS.
    # Here we still register them (BFF also registers for internal discoverability).

    env           = cfg["_env"]
    shared        = cfg["_shared"]
    discovery_name = sd_cfg["discovery_name"]
    namespace_id  = ssm_get(ssm_client, f"/orderflow/{env}/infra/cloudmap-namespace-id")

    print(f"[cloudmap] Ensuring service: {discovery_name} in namespace {namespace_id}")

    # Check if service already exists in this namespace
    paginator = sd_client.get_paginator("list_services")
    for page in paginator.paginate(Filters=[{"Name": "NAMESPACE_ID", "Values": [namespace_id]}]):
        for svc in page["Services"]:
            if svc["Name"] == discovery_name:
                print(f"[cloudmap] Already exists: {svc['Arn']}")
                return svc["Id"]

    # Create service entry
    resp = sd_client.create_service(
        Name=discovery_name,
        DnsConfig={
            "NamespaceId": namespace_id,
            "DnsRecords": [{"TTL": 10, "Type": "A"}],
            "RoutingPolicy": "MULTIVALUE"
        },
        HealthCheckCustomConfig={"FailureThreshold": 1},
        Tags=[
            {"Key": "Service",    "Value": cfg["_service"]},
            {"Key": "managed-by", "Value": "deploy-pipeline"}
        ]
    )
    sd_service_id  = resp["Service"]["Id"]
    sd_service_arn = resp["Service"]["Arn"]
    print(f"[cloudmap] Created: {sd_service_arn}")
    return sd_service_id


# ── Step 4: Build + register ECS task definition ──────────────────────────────

def register_task_definition(ecs_client, ssm_client, cfg: dict, image_tag: str, log_group: str, task_role_arn: str) -> str:
    service  = cfg["_service"]
    env      = cfg["_env"]
    shared   = cfg["_shared"]
    compute  = cfg["compute"]
    container = cfg["container"]

    # Execution role ARN from SSM
    execution_role_arn = ssm_get(ssm_client, f"/orderflow/{env}/infra/execution-role-arn")

    # Environment variables
    env_vars = [{"name": "ENV", "value": env}]
    for k, v in cfg.get("env", {}).items():
        env_vars.append({"name": k, "value": str(v)})

    # Secrets (SSM paths → ECS secrets format)
    secrets = []
    for var_name, secret_cfg in cfg.get("env_secrets", {}).items():
        ssm_path = secret_cfg["ssm_path"]
        account  = shared["account_id"]
        region   = shared["region"]
        arn      = f"arn:aws:ssm:{region}:{account}:parameter{ssm_path}"
        secrets.append({"name": var_name, "valueFrom": arn})

    image = f"{shared['ecr_registry']}/{shared['project']}/{service}:{image_tag}"

    container_def = {
        "name":      service,
        "image":     image,
        "essential": True,
        "memory":    int(compute["memory"]),
        "cpu":       int(compute["cpu"]),
        "portMappings": [{
            "containerPort": int(container["port"]),
            "hostPort":      int(container["port"]),
            "protocol":      "tcp"
        }],
        "environment":  env_vars,
        "secrets":      secrets,
        "logConfiguration": {
            "logDriver": "awslogs",
            "options": {
                "awslogs-group":         log_group,
                "awslogs-region":        shared["region"],
                "awslogs-stream-prefix": env
            }
        },
        "healthCheck": {
            "command":     ["CMD-SHELL", container["health_check_command"]],
            "interval":    int(compute.get("health_check_interval", 30)),
            "timeout":     int(compute.get("health_check_timeout", 5)),
            "retries":     int(compute.get("health_check_retries", 3)),
            "startPeriod": int(compute.get("health_check_start_period", 60))
        }
    }

    family = f"{service}-{env}"
    print(f"[ecs] Registering task definition: {family}")

    resp = ecs_client.register_task_definition(
        family=family,
        networkMode=shared.get("network_mode", "bridge"),
        requiresCompatibilities=["EC2"],
        executionRoleArn=execution_role_arn,
        taskRoleArn=task_role_arn,
        containerDefinitions=[container_def],
        tags=[
            {"key": "Service",    "value": service},
            {"key": "managed-by", "value": "deploy-pipeline"}
        ]
    )

    task_def_arn = resp["taskDefinition"]["taskDefinitionArn"]
    revision     = resp["taskDefinition"]["revision"]
    print(f"[ecs] Task definition registered: {family}:{revision}")
    return task_def_arn


# ── Step 5: Create or update ECS service ──────────────────────────────────────

def deploy_ecs_service(ecs_client, ssm_client, sd_service_id: str | None, cfg: dict, task_def_arn: str):
    service      = cfg["_service"]
    env          = cfg["_env"]
    compute      = cfg["compute"]
    lb_cfg       = cfg.get("load_balancer", {})
    sd_cfg       = cfg.get("service_discovery", {})
    deployment   = cfg.get("deployment", {})

    cluster_name = ssm_get(ssm_client, f"/orderflow/{env}/infra/cluster-name")

    # Build service_registries block for Cloud Map
    service_registries = []
    if sd_service_id:
        sd_client_inner = boto3.client("servicediscovery", region_name=cfg["_shared"]["region"])
        sd_arn = sd_client_inner.get_service(Id=sd_service_id)["Service"]["Arn"]
        service_registries = [{
            "registryArn":   sd_arn,
            "containerName": service,
            "containerPort": int(cfg["container"]["port"])
        }]

    # Build load_balancers block for ALB services
    load_balancers = []
    if lb_cfg:
        tg_arn = ssm_get(ssm_client, lb_cfg["target_group_ssm"])
        load_balancers = [{
            "targetGroupArn": tg_arn,
            "containerName":  service,
            "containerPort":  int(cfg["container"]["port"])
        }]

    # Deployment configuration
    deployment_config = {}
    if deployment.get("circuit_breaker"):
        deployment_config["deploymentCircuitBreaker"] = {
            "enable":   True,
            "rollback": deployment.get("rollback_on_failure", True)
        }

    desired = int(compute.get("desired_count", 1))
    grace   = int(compute.get("health_check_grace_period", 60) if load_balancers else 0)

    # Check if ECS service already exists
    resp = ecs_client.describe_services(cluster=cluster_name, services=[service])
    existing = [s for s in resp["services"] if s["status"] != "INACTIVE"]

    if existing:
        print(f"[ecs] Updating service: {service}")
        ecs_client.update_service(
            cluster=cluster_name,
            service=service,
            taskDefinition=task_def_arn,
            desiredCount=desired,
            deploymentConfiguration=deployment_config,
            healthCheckGracePeriodSeconds=grace,
            forceNewDeployment=True
        )
        print(f"[ecs] Service updated — new deployment started.")
    else:
        print(f"[ecs] Creating service: {service}")
        create_kwargs = dict(
            cluster=cluster_name,
            serviceName=service,
            taskDefinition=task_def_arn,
            desiredCount=desired,
            launchType="EC2",
            deploymentConfiguration=deployment_config,
            healthCheckGracePeriodSeconds=grace,
            enableECSManagedTags=True,
            propagateTags="SERVICE",
            tags=[
                {"key": "Service",    "value": service},
                {"key": "managed-by", "value": "deploy-pipeline"}
            ]
        )
        if load_balancers:
            create_kwargs["loadBalancers"] = load_balancers
        if service_registries:
            create_kwargs["serviceRegistries"] = service_registries

        ecs_client.create_service(**create_kwargs)
        print(f"[ecs] Service created.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deploy an ECS service from service.yaml.")
    parser.add_argument("--service",   required=True, help="Service name (e.g. bff, order-service)")
    parser.add_argument("--env",       required=True, help="Environment: dev | sit")
    parser.add_argument("--image-tag", default=os.environ.get("IMAGE_TAG", "latest"), help="Docker image tag")
    args = parser.parse_args()

    service   = args.service
    env       = args.env
    image_tag = args.image_tag

    print(f"\n{'='*60}")
    print(f"  Deploying: {service}  |  env: {env}  |  image: {image_tag}")
    print(f"{'='*60}\n")

    cfg    = build_config(service, env)
    region = cfg["_shared"]["region"]

    # AWS clients
    ecs_client  = boto3.client("ecs",              region_name=region)
    iam_client  = boto3.client("iam",              region_name=region)
    logs_client = boto3.client("logs",             region_name=region)
    ssm_client  = boto3.client("ssm",              region_name=region)
    sd_client   = boto3.client("servicediscovery", region_name=region)

    # Step 1 — Log group
    log_group = ensure_log_group(logs_client, cfg)
    print()

    # Step 2 — IAM task role
    task_role_arn = ensure_task_role(iam_client, cfg)
    print()

    # Step 3 — Cloud Map (all services register — BFF too for internal discoverability)
    sd_service_id = ensure_cloud_map_service(sd_client, ssm_client, cfg)
    print()

    # Step 4 — Task definition
    task_def_arn = register_task_definition(
        ecs_client, ssm_client, cfg, image_tag, log_group, task_role_arn
    )
    print()

    # Step 5 — ECS service
    deploy_ecs_service(ecs_client, ssm_client, sd_service_id, cfg, task_def_arn)

    print(f"\n[done] {service} deployed to {env}.\n")


if __name__ == "__main__":
    main()
