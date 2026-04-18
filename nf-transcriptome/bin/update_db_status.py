#!/usr/bin/env python3
"""
update_db_status.py — Send pipeline status updates to NextJS web app

POSTs status updates to the web application's API after each major pipeline
step completes.  This enables real-time status tracking in the browser UI.

CRITICAL DESIGN DECISION:
  This script NEVER exits with a non-zero code.  If the API is unreachable,
  it prints a warning to stderr and exits 0.  The pipeline should never fail
  because of a status update failure.

Usage:
  update_db_status.py \\
    --api_url http://localhost:3000/api \\
    --run_id run_20240315_120000 \\
    --step TRINITY \\
    --status completed \\
    --metrics_path /path/to/metrics.json

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def send_status_update(
    api_url: str,
    run_id: str,
    step: str,
    status: str,
    metrics_path: str = "",
) -> bool:
    """
    POST a status update to the NextJS API.

    Args:
        api_url: Base API URL (e.g., "http://localhost:3000/api")
        run_id: Pipeline run identifier
        step: Pipeline step name (e.g., "TRINITY")
        status: Step status ("running", "completed", "failed")
        metrics_path: Optional path to a metrics JSON file

    Returns:
        True if the update was sent successfully, False otherwise
    """
    # Load metrics from file if provided
    metrics = {}
    if metrics_path and metrics_path != "" and Path(metrics_path).exists():
        try:
            with open(metrics_path) as f:
                metrics = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass

    payload = {
        "run_id": run_id,
        "step": step,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }

    url = f"{api_url}/pipeline/status"
    data = json.dumps(payload).encode("utf-8")

    try:
        req = Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # 5-second timeout — don't block the pipeline waiting for the API
        response = urlopen(req, timeout=5)
        print(
            f"Status update sent: {step} → {status} (HTTP {response.status})",
            file=sys.stderr,
        )
        return True
    except URLError as e:
        print(
            f"WARNING: Could not send status update for {step}: {e}",
            file=sys.stderr,
        )
        return False
    except Exception as e:
        print(
            f"WARNING: Unexpected error sending status update for {step}: {e}",
            file=sys.stderr,
        )
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Send pipeline status update to NextJS API"
    )
    parser.add_argument(
        "--api_url",
        type=str,
        required=True,
        help="Base API URL (e.g., http://localhost:3000/api)",
    )
    parser.add_argument(
        "--run_id", type=str, required=True, help="Pipeline run identifier"
    )
    parser.add_argument(
        "--step",
        type=str,
        required=True,
        help="Pipeline step name (e.g., TRINITY)",
    )
    parser.add_argument(
        "--status",
        type=str,
        required=True,
        choices=["running", "completed", "failed"],
        help="Step status",
    )
    parser.add_argument(
        "--metrics_path",
        type=str,
        default="",
        help="Path to metrics JSON file (optional)",
    )
    args = parser.parse_args()

    # Send the update — always exit 0 regardless of success/failure
    send_status_update(
        api_url=args.api_url,
        run_id=args.run_id,
        step=args.step,
        status=args.status,
        metrics_path=args.metrics_path,
    )

    # Always exit 0 — status updates are informational, not critical
    sys.exit(0)


if __name__ == "__main__":
    main()
