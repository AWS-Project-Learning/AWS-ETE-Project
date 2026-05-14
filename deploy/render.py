#!/usr/bin/env python3
"""
ECS Service Renderer  (Phase 1 of 2)
======================================
Reads deploy/{service}/service.yaml + deploy/{service}/values-{env}.yaml,
fetches platform values from SSM, and writes all AWS manifests to
deploy/out/{service}/{env}/.

Output files (all human-readable JSON — inspect before applying):
  out/{service}/{env}/meta.json          — cluster, log group, role name, etc.
  out/{service}/{env}/iam-trust.json     — IAM trust policy
  out/{service}/{env}/iam-policy.json    — IAM inline policy  (omitted if no policies)
  out/{service}/{env}/task-def.json      — ECS task definition
  out/{service}/{env}/cloudmap.json      — Cloud Map service config  (omitted if no SD)
  out/{service}/{env}/ecs-service.json   — ECS service desired state

After reviewing the output, run:
    python apply.py --service <name> --env <env>

Usage:
    python render.py --service bff         --env dev --image-tag a1b2c3d
    python render.py --service order-service --env sit --image-tag v1.2.3
"""

import argparse
import json
import os
import sys
from pathlib import Path

import boto3
import yaml
from botocore.exceptions import ClientError

DEPLOY_DIR = Path(__file__).parent
OUT_DIR    = DEPLOY_DIR / "out"


# ── Config loading ─────────────────────────────────────────────────────────────

def load_yaml(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"[ERROR] File not found: {path}")
    with open(path) as f:
        return yaml.safe_load(f) or {}


def deep_merge(base: dict, override: dict) -> dict:
    result = base.copy()
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def resolve_placeholders(obj, ctx: dict):
    if isinstance(obj, str):  return obj.format(**ctx)
    if isinstance(obj, dict): return {k: resolve_placeholders(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list): return [resolve_placeholders(i, ctx) for i in obj]
    return obj


def build_config(service: str, env: str) -> dict:
    shared   = load_yaml(DEPLOY_DIR / "shared.yaml")
    svc      = load_yaml(DEPLOY_DIR / service / "service.yaml")
    env_vals = load_yaml(DEPLOY_DIR / service / f"values-{env}.yaml")

    cfg = deep_merge(svc, env_vals)
    cfg["compute"] = deep_merge(shared.get("defaults", {}), cfg.get("compute", {}))

    ctx = {
        "env":        env,
        "region":     shared["region"],
        "account_id": shared["account_id"],
        "project":    shared["project"],
        "service":    service,
    }
    cfg = resolve_placeholders(cfg, ctx)
    cfg.update({"_shared": shared, "_env": env, "_service": service})
    return cfg


def ssm_get(ssm_client, path: str) -> str:
    try:
        return ssm_client.get_parameter(Name=path, WithDecryption=True)["Parameter"]["Value"]
    except ClientError as e:
        sys.exit(f"[ERROR] SSM not found: {path}\n  {e}")


def write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  wrote  {path.relative_to(DEPLOY_DIR)}")


# ── Manifest builders ──────────────────────────────────────────────────────────

def build_iam_trust() -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect":    "Allow",
            "Principal": {"Service": "ecs-tasks.amazonaws.com"},
            "Action":    "sts:AssumeRole"
        }]
    }


def build_iam_policy(service: str, cfg: dict) -> dict | None:
    policies = cfg.get("iam", {}).get("policies", [])
    if not policies:
        return None
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid":      p["sid"],
                "Effect":   "Allow",
                "Action":   p["actions"],
                "Resource": p["resources"]
            }
            for p in policies
        ]
    }


def build_task_def(
    service: str,
    env: str,
    image_tag: str,
    cfg: dict,
    execution_role_arn: str,
    task_role_arn: str,
    log_group: str,
) -> dict:
    shared  = cfg["_shared"]
    compute = cfg["compute"]
    ctr     = cfg["container"]

    env_vars = [{"name": "ENV", "value": env}]
    for k, v in cfg.get("env", {}).items():
        env_vars.append({"name": k, "value": str(v)})

    secrets = []
    for var_name, secret_cfg in cfg.get("env_secrets", {}).items():
        ssm_path = secret_cfg["ssm_path"]
        arn = f"arn:aws:ssm:{shared['region']}:{shared['account_id']}:parameter{ssm_path}"
        secrets.append({"name": var_name, "valueFrom": arn})

    image = f"{shared['ecr_registry']}/{shared['project']}/{service}:{image_tag}"

    return {
        "family":                  f"{service}-{env}",
        "networkMode":             shared.get("network_mode", "bridge"),
        "requiresCompatibilities": ["EC2"],
        "executionRoleArn":        execution_role_arn,
        "taskRoleArn":             task_role_arn,
        "containerDefinitions": [{
            "name":      service,
            "image":     image,
            "essential": True,
            "memory":    int(compute["memory"]),
            "cpu":       int(compute["cpu"]),
            "portMappings": [{
                "containerPort": int(ctr["port"]),
                "hostPort":      int(ctr["port"]),
                "protocol":      "tcp"
            }],
            "environment": env_vars,
            "secrets":     secrets,
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group":         log_group,
                    "awslogs-region":        shared["region"],
                    "awslogs-stream-prefix": env
                }
            },
            "healthCheck": {
                "command":     ["CMD-SHELL", ctr["health_check_command"]],
                "interval":    int(compute.get("health_check_interval", 30)),
                "timeout":     int(compute.get("health_check_timeout", 5)),
                "retries":     int(compute.get("health_check_retries", 3)),
                "startPeriod": int(compute.get("health_check_start_period", 60))
            }
        }],
        "tags": [
            {"key": "Service",    "value": service},
            {"key": "managed-by", "value": "deploy-pipeline"}
        ]
    }


def build_cloudmap(service: str, cfg: dict, namespace_id: str) -> dict | None:
    sd_cfg = cfg.get("service_discovery", {})
    if not sd_cfg:
        return None
    return {
        "Name":        sd_cfg["discovery_name"],
        "NamespaceId": namespace_id,
        "DnsConfig": {
            "NamespaceId": namespace_id,
            "DnsRecords":  [{"TTL": 10, "Type": "SRV"}],
            "RoutingPolicy": "WEIGHTED"
        },
        "HealthCheckCustomConfig": {"FailureThreshold": 1},
        "Tags": [
            {"Key": "Service",    "Value": service},
            {"Key": "managed-by", "Value": "deploy-pipeline"}
        ]
    }


def build_ecs_service(
    service: str,
    cfg: dict,
    cluster_name: str,
    tg_arn: str | None,
) -> dict:
    compute    = cfg["compute"]
    lb_cfg     = cfg.get("load_balancer", {})
    sd_cfg     = cfg.get("service_discovery", {})
    deployment = cfg.get("deployment", {})

    desired = int(compute.get("desired_count", 1))
    grace   = int(compute.get("health_check_grace_period", 60)) if lb_cfg else 0

    load_balancers = []
    if lb_cfg and tg_arn:
        load_balancers = [{
            "targetGroupArn": tg_arn,
            "containerName":  service,
            "containerPort":  int(cfg["container"]["port"])
        }]

    # Cloud Map ARN is unknown at render time — apply.py resolves it.
    # The _cloudmap_name field signals apply.py to look it up.
    service_registries = []
    if sd_cfg:
        service_registries = [{
            "_cloudmap_name": sd_cfg["discovery_name"],
            "containerName":  service,
            "containerPort":  int(cfg["container"]["port"])
        }]

    deployment_config = {}
    if deployment.get("circuit_breaker"):
        deployment_config["deploymentCircuitBreaker"] = {
            "enable":   True,
            "rollback": deployment.get("rollback_on_failure", True)
        }

    return {
        "cluster":                       cluster_name,
        "serviceName":                   service,
        "desiredCount":                  desired,
        "launchType":                    "EC2",
        "healthCheckGracePeriodSeconds": grace,
        "deploymentConfiguration":       deployment_config,
        "loadBalancers":                 load_balancers,
        "serviceRegistries":             service_registries,
        "enableECSManagedTags":          True,
        "propagateTags":                 "SERVICE",
        "tags": [
            {"key": "Service",    "value": service},
            {"key": "managed-by", "value": "deploy-pipeline"}
        ]
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Render ECS service manifests to out/{service}/{env}/."
    )
    parser.add_argument("--service",   required=True, help="e.g. bff, order-service")
    parser.add_argument("--env",       required=True, help="dev | sit")
    parser.add_argument("--image-tag", default=os.environ.get("IMAGE_TAG", "latest"),
                        help="Docker image tag (7-digit SHA recommended)")
    args = parser.parse_args()

    service, env, image_tag = args.service, args.env, args.image_tag

    print(f"\n{'='*60}")
    print(f"  Rendering: {service}  |  env: {env}  |  image: {image_tag}")
    print(f"{'='*60}")

    cfg    = build_config(service, env)
    shared = cfg["_shared"]
    region = shared["region"]

    # ── Fetch SSM platform values (written by Terraform) ──────────────────────
    ssm = boto3.client("ssm", region_name=region)
    execution_role_arn = ssm_get(ssm, f"/orderflow/{env}/infra/execution-role-arn")
    cluster_name       = ssm_get(ssm, f"/orderflow/{env}/infra/cluster-name")
    namespace_id       = ssm_get(ssm, f"/orderflow/{env}/infra/cloudmap-namespace-id")

    tg_arn = None
    lb_cfg = cfg.get("load_balancer", {})
    if lb_cfg:
        tg_arn = ssm_get(ssm, lb_cfg["target_group_ssm"])

    role_name     = f"ecs-task-role-{service}"
    task_role_arn = f"arn:aws:iam::{shared['account_id']}:role/{role_name}"
    log_group     = f"/ecs/{shared['project']}/{env}/{service}"

    # ── Build manifests ────────────────────────────────────────────────────────
    meta = {
        "service":      service,
        "env":          env,
        "region":       region,
        "cluster_name": cluster_name,
        "log_group":    log_group,
        "role_name":    role_name,
        "namespace_id": namespace_id,
        "has_alb":      bool(lb_cfg),
        "has_cloudmap": bool(cfg.get("service_discovery")),
    }

    iam_trust  = build_iam_trust()
    iam_policy = build_iam_policy(service, cfg)
    task_def   = build_task_def(service, env, image_tag, cfg, execution_role_arn, task_role_arn, log_group)
    cloudmap   = build_cloudmap(service, cfg, namespace_id)
    ecs_svc    = build_ecs_service(service, cfg, cluster_name, tg_arn)

    # ── Write all files ────────────────────────────────────────────────────────
    out = OUT_DIR / service / env
    print(f"\n[render] Writing manifests to deploy/out/{service}/{env}/")

    write_json(out / "meta.json",        meta)
    write_json(out / "iam-trust.json",   iam_trust)
    if iam_policy:
        write_json(out / "iam-policy.json",  iam_policy)
    write_json(out / "task-def.json",    task_def)
    if cloudmap:
        write_json(out / "cloudmap.json",    cloudmap)
    write_json(out / "ecs-service.json", ecs_svc)

    print(f"""
[render] Done. Review the files above, then run:
  python apply.py --service {service} --env {env}
""")


if __name__ == "__main__":
    main()
