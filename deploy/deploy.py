#!/usr/bin/env python3
"""
LOCAL CONVENIENCE ONLY — not used in CI.

In CI, render and apply are separate jobs with an approval gate between them.
See .github/workflows/deploy.yml for the production deployment flow:

  render job  →  upload artifact  →  manual approval  →  apply job

Local shortcut (skips approval gate — use with caution):
    python deploy.py --service bff --env dev --image-tag a1b2c3d

Two-phase local flow (mirrors CI exactly):
    python render.py --service bff --env dev --image-tag a1b2c3d
    # review deploy/out/bff/dev/*.json
    python apply.py  --service bff --env dev
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent


def run(cmd: list[str]):
    result = subprocess.run(cmd)
    if result.returncode != 0:
        sys.exit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description="Render + apply an ECS service deployment.")
    parser.add_argument("--service",   required=True, help="e.g. bff, order-service")
    parser.add_argument("--env",       required=True, help="dev | sit")
    parser.add_argument("--image-tag", default=os.environ.get("IMAGE_TAG", "latest"),
                        help="Docker image tag (7-digit SHA recommended)")
    args = parser.parse_args()

    py = sys.executable

    run([py, str(HERE / "render.py"),
         "--service",   args.service,
         "--env",       args.env,
         "--image-tag", args.image_tag])

    run([py, str(HERE / "apply.py"),
         "--service", args.service,
         "--env",     args.env])


if __name__ == "__main__":
    main()
