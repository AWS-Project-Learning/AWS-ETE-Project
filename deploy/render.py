#!/usr/bin/env python3
"""
ECS Task Definition Renderer
=============================
Merges global defaults (values.yaml) with environment-specific values
(values-{env}.yaml) and renders service.yaml into an ECS-ready task
definition JSON for a given service.

Usage:
    python render.py --service order-service --env dev [--out task-def.json]

The rendered JSON can be passed directly to:
    aws ecs register-task-definition --cli-input-json file://task-def.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined

DEPLOY_DIR = Path(__file__).parent


def load_yaml(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base (override wins on conflicts)."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def build_context(service_name: str, env: str) -> dict:
    defaults = load_yaml(DEPLOY_DIR / "values.yaml")
    env_values = load_yaml(DEPLOY_DIR / f"values-{env}.yaml")

    # Merge global sections
    global_ctx = deep_merge(
        defaults.get("global", {}),
        env_values.get("global", {})
    )

    # Merge service defaults with the specific service block
    service_defaults = defaults.get("service_defaults", {})
    service_overrides = env_values.get("services", {}).get(service_name, {})

    if not service_overrides:
        print(f"[ERROR] Service '{service_name}' not found in values-{env}.yaml", file=sys.stderr)
        sys.exit(1)

    service_ctx = deep_merge(service_defaults, service_overrides)

    # Flatten into a single context dict for Jinja2
    context = {
        **global_ctx,
        **service_ctx,
        "service_name": service_name,
        "environment": env,
        "image_tag": os.environ.get("IMAGE_TAG", "latest"),
    }

    return context


def render(service_name: str, env: str) -> str:
    context = build_context(service_name, env)

    jinja_env = Environment(
        loader=FileSystemLoader(str(DEPLOY_DIR)),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )

    template = jinja_env.get_template("service.yaml")
    rendered = template.render(**context)

    # Validate it's valid JSON
    try:
        parsed = json.loads(rendered)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Rendered output is not valid JSON: {e}", file=sys.stderr)
        print("--- Rendered output ---", file=sys.stderr)
        print(rendered, file=sys.stderr)
        sys.exit(1)

    return json.dumps(parsed, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Render ECS task definition from values files.")
    parser.add_argument("--service", required=True, help="Service name (e.g. order-service)")
    parser.add_argument("--env",     required=True, help="Environment (dev | sit)")
    parser.add_argument("--out",     default=None,  help="Output file path (default: stdout)")
    args = parser.parse_args()

    output = render(args.service, args.env)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output)
        print(f"[OK] Written to {out_path}")
    else:
        print(output)


if __name__ == "__main__":
    main()
