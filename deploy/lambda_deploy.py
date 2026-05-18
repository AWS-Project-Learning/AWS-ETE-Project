#!/usr/bin/env python3
"""
lambda_deploy.py — Lambda code deploy (equivalent of render.py + apply.py for ECS)
====================================================================================
Reads deploy/{service}/service.yaml + deploy/{service}/values-{env}.yaml,
zips the source code, and updates the Lambda function code + configuration.

Separation of concerns:
  Terraform (infra/agents.tf) : IAM role, DynamoDB, EventBridge, SSM params
  This script                 : function code, env vars, timeout, memory

Usage:
    python deploy/lambda_deploy.py --service vulnerability-agent --env dev
    python deploy/lambda_deploy.py --service vulnerability-agent --env dev --dry-run

Flags:
    --dry-run   Print exactly what will change without touching AWS.
                Equivalent to `terraform plan`.
"""

import argparse
import os
import sys
import time
import zipfile
import tempfile
from pathlib import Path

import boto3
import yaml
from botocore.exceptions import ClientError

DEPLOY_DIR = Path(__file__).parent
REPO_ROOT  = DEPLOY_DIR.parent


# ── Config helpers ─────────────────────────────────────────────────────────────

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
    ctx = {
        "env":        env,
        "region":     shared["region"],
        "account_id": shared["account_id"],
        "project":    shared["project"],
        "service":    service,
    }
    cfg = resolve_placeholders(cfg, ctx)
    cfg["_shared"] = shared
    cfg["_env"]    = env
    cfg["_service"] = service
    return cfg


def ssm_get(ssm_client, path: str) -> str:
    try:
        return ssm_client.get_parameter(Name=path, WithDecryption=False)["Parameter"]["Value"]
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code == "ParameterNotFound":
            sys.exit(
                f"\n[ERROR] SSM parameter not found: {path}\n"
                f"  Run terraform apply (infra pipeline) first to create it.\n"
            )
        if code in ("AccessDeniedException", "AccessDenied"):
            sys.exit(
                f"\n[ERROR] Access denied reading SSM: {path}\n"
                f"  The GitHub Actions OIDC role needs ssm:GetParameter on this path.\n"
                f"  This permission is granted by infra/agents.tf — run terraform apply.\n"
            )
        raise


# ── Zip builder ────────────────────────────────────────────────────────────────

def create_zip(source_dir: Path) -> str:
    """
    Zip all .py files from source_dir into a temp zip file.
    Excludes: __pycache__, *.pyc, requirements.txt, .build/, test_*.py
    Returns the path to the zip file.
    """
    if not source_dir.exists():
        sys.exit(
            f"\n[ERROR] Source directory not found: {source_dir}\n"
            f"  Check lambda.source_dir in service.yaml — path is relative to repo root.\n"
        )

    py_files = [f for f in source_dir.glob("*.py") if not f.name.startswith("test_")]
    if not py_files:
        sys.exit(f"\n[ERROR] No .py files found in {source_dir}\n")

    fd, zip_path = tempfile.mkstemp(suffix=".zip", prefix="lambda-deploy-")
    os.close(fd)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for py_file in sorted(py_files):
            zf.write(py_file, py_file.name)
            print(f"  [zip] added: {py_file.name}  ({py_file.stat().st_size:,} bytes)")

    zip_size = Path(zip_path).stat().st_size
    print(f"  [zip] total size: {zip_size:,} bytes ({zip_size // 1024} KB)")
    return zip_path


# ── Lambda state helpers ───────────────────────────────────────────────────────

LAMBDA_ACTIVE_POLL_SECONDS  = 3
LAMBDA_ACTIVE_TIMEOUT_SECONDS = 120


def wait_for_lambda_active(lmb, function_name: str):
    """
    Poll until the Lambda function state is Active.
    A function can be in 'Pending' state after creation or while an update
    is in progress. Attempting update_function_code on a Pending function
    raises ResourceConflictException.
    """
    deadline = time.time() + LAMBDA_ACTIVE_TIMEOUT_SECONDS
    while True:
        try:
            resp  = lmb.get_function_configuration(FunctionName=function_name)
            state = resp.get("State", "Active")
            if state == "Active":
                return
            remaining = int(deadline - time.time())
            if remaining <= 0:
                sys.exit(
                    f"\n[ERROR] Lambda '{function_name}' stuck in state '{state}' "
                    f"after {LAMBDA_ACTIVE_TIMEOUT_SECONDS}s.\n"
                    f"  Check the Lambda console for errors, then retry.\n"
                )
            print(f"  [lambda] State={state} — waiting ({remaining}s remaining)...")
            time.sleep(LAMBDA_ACTIVE_POLL_SECONDS)
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceNotFoundException":
                sys.exit(
                    f"\n[ERROR] Lambda function '{function_name}' does not exist.\n"
                    f"  Run terraform apply (infra pipeline) first to create it.\n"
                    f"  The infra pipeline creates the function with a stub handler;\n"
                    f"  this script then pushes the real code.\n"
                )
            raise


def wait_for_update_complete(lmb, function_name: str, operation: str):
    """Wait for a Lambda update (code or config) to reach Successful status."""
    print(f"  [lambda] Waiting for {operation} to complete...")
    try:
        waiter = lmb.get_waiter("function_updated_v2")
        waiter.wait(
            FunctionName=function_name,
            WaiterConfig={"Delay": 3, "MaxAttempts": 40},
        )
    except Exception:
        # Fallback: manual poll if waiter not available in this boto3 version
        deadline = time.time() + 120
        while time.time() < deadline:
            resp   = lmb.get_function_configuration(FunctionName=function_name)
            status = resp.get("LastUpdateStatus", "Successful")
            if status == "Successful":
                return
            if status == "Failed":
                reason = resp.get("LastUpdateStatusReasonCode", "")
                sys.exit(f"\n[ERROR] Lambda {operation} failed: {reason}\n")
            time.sleep(3)


# ── Deploy ─────────────────────────────────────────────────────────────────────

def deploy(service: str, env: str, dry_run: bool):
    cfg    = build_config(service, env)
    shared = cfg["_shared"]
    region = shared["region"]

    if cfg.get("type") != "lambda":
        sys.exit(
            f"\n[ERROR] service.yaml for '{service}' has type='{cfg.get('type')}', expected 'lambda'.\n"
            f"  Use deploy/render.py + deploy/apply.py for ECS services.\n"
        )

    lmb_cfg     = cfg.get("lambda", {})
    source_dir  = REPO_ROOT / lmb_cfg.get("source_dir", f"agents/{service}")
    timeout     = int(lmb_cfg.get("timeout", 300))
    memory      = int(lmb_cfg.get("memory", 256))
    handler     = lmb_cfg.get("handler", "handler.handler")
    runtime     = lmb_cfg.get("runtime", "python3.12")
    env_vars    = cfg.get("env", {})

    # Lambda function name: read from SSM (written by Terraform in agents.tf)
    # so there's one source of truth — the infra, not a hardcoded string here.
    ssm          = boto3.client("ssm", region_name=region)
    ssm_name_key = f"/orderflow/{env}/agents/lambda-function-name"
    function_name = ssm_get(ssm, ssm_name_key)

    # ── Dry run ────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  {'DRY RUN — ' if dry_run else ''}Lambda Deploy: {service} → {env}")
    print(f"{'='*60}")
    print(f"  Function  : {function_name}")
    print(f"  Source    : {source_dir.relative_to(REPO_ROOT)}")
    print(f"  Handler   : {handler}")
    print(f"  Runtime   : {runtime}")
    print(f"  Timeout   : {timeout}s")
    print(f"  Memory    : {memory} MB")
    print(f"  Env vars  :")
    for k, v in env_vars.items():
        print(f"    {k} = {v}")

    if dry_run:
        print(f"\n  [dry-run] No changes made. Remove --dry-run to apply.\n")
        return

    # ── Build zip ──────────────────────────────────────────────────────────────
    print(f"\n[1/4] Building zip from {source_dir.relative_to(REPO_ROOT)}/")
    zip_path = create_zip(source_dir)

    lmb = boto3.client("lambda", region_name=region)

    # ── Wait for function to be Active ─────────────────────────────────────────
    print(f"\n[2/4] Checking Lambda state...")
    wait_for_lambda_active(lmb, function_name)
    print(f"  [lambda] State=Active — ready to update.")

    # ── Update function code ───────────────────────────────────────────────────
    print(f"\n[3/4] Updating function code...")
    try:
        with open(zip_path, "rb") as f:
            lmb.update_function_code(
                FunctionName=function_name,
                ZipFile=f.read(),
                Publish=False,
            )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("AccessDeniedException", "AccessDenied"):
            sys.exit(
                f"\n[ERROR] Access denied calling lambda:UpdateFunctionCode.\n"
                f"  The OIDC role needs lambda:UpdateFunctionCode on:\n"
                f"    {function_name}\n"
                f"  This permission is added by agents.tf — run terraform apply (infra pipeline).\n"
            )
        raise

    wait_for_update_complete(lmb, function_name, "code update")
    print(f"  [lambda] Code updated.")

    # ── Update function configuration (env vars, timeout, memory) ─────────────
    print(f"\n[4/4] Updating function configuration...")
    lmb.update_function_configuration(
        FunctionName=function_name,
        Timeout=timeout,
        MemorySize=memory,
        Environment={"Variables": {k: str(v) for k, v in env_vars.items()}},
    )
    wait_for_update_complete(lmb, function_name, "config update")
    print(f"  [lambda] Configuration updated.")

    # Cleanup temp zip
    os.unlink(zip_path)

    print(f"\n{'='*60}")
    print(f"  Done — {function_name} deployed successfully.")
    print(f"  Trigger a scan: Actions → AI Vulnerability Agent → Run workflow → scan")
    print(f"{'='*60}\n")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Deploy Lambda function code and configuration from service.yaml."
    )
    parser.add_argument("--service",  required=True, help="e.g. vulnerability-agent")
    parser.add_argument("--env",      required=True, help="dev | sit")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Print what will change without touching AWS (like terraform plan)")
    args = parser.parse_args()

    deploy(args.service, args.env, args.dry_run)


if __name__ == "__main__":
    main()
