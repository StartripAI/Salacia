#!/usr/bin/env python3
"""Generate a reproducible SWE-bench sample with proportional stratification by repo."""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate reproducible SWE-bench sample")
    parser.add_argument("--dataset", default="SWE-bench/SWE-bench_Verified")
    parser.add_argument("--split", default="test")
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default="config/swebench_100_sample.json")
    parser.add_argument(
        "--instances-file",
        help="Optional local JSON array fixture with objects containing instance_id and repo"
    )
    return parser.parse_args()


def load_instances(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.instances_file:
        payload = json.loads(Path(args.instances_file).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError("--instances-file must be a JSON array")
        normalized: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            instance_id = str(item.get("instance_id", "")).strip()
            repo = str(item.get("repo", "")).strip()
            if not instance_id or not repo:
                continue
            normalized.append({"instance_id": instance_id, "repo": repo})
        if not normalized:
            raise ValueError("--instances-file has no valid rows")
        return normalized

    from datasets import load_dataset  # type: ignore

    dataset = load_dataset(args.dataset, split=args.split)
    rows: list[dict[str, Any]] = []
    for row in dataset:
        instance_id = str(row.get("instance_id", "")).strip()
        repo = str(row.get("repo", "")).strip()
        if instance_id and repo:
            rows.append({"instance_id": instance_id, "repo": repo})
    if not rows:
        raise ValueError("dataset returned zero valid rows")
    return rows


def proportional_allocations(groups: dict[str, list[dict[str, Any]]], target_count: int) -> dict[str, int]:
    total = sum(len(items) for items in groups.values())
    if total == 0:
        raise ValueError("cannot allocate from empty groups")

    base: dict[str, int] = {}
    fractional: list[tuple[str, float]] = []
    allocated = 0

    for repo, items in groups.items():
        exact = target_count * (len(items) / total)
        initial = min(len(items), math.floor(exact))
        base[repo] = initial
        allocated += initial
        fractional.append((repo, exact - math.floor(exact)))

    remainder = max(0, target_count - allocated)
    fractional.sort(key=lambda it: (-it[1], it[0]))

    while remainder > 0:
        progressed = False
        for repo, _ in fractional:
            if remainder <= 0:
                break
            if base[repo] >= len(groups[repo]):
                continue
            base[repo] += 1
            remainder -= 1
            progressed = True
        if not progressed:
            break

    return base


def build_sample(instances: list[dict[str, Any]], dataset: str, split: str, seed: int, count: int) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in instances:
        groups[row["repo"]].append(row)

    total_available = sum(len(items) for items in groups.values())
    target = min(count, total_available)
    allocations = proportional_allocations(groups, target)

    rng = random.Random(seed)
    selected: list[dict[str, Any]] = []
    strata: list[dict[str, Any]] = []

    for repo in sorted(groups.keys()):
        rows = groups[repo]
        n = allocations.get(repo, 0)
        rng_repo = random.Random(f"{seed}:{repo}")
        picked = rng_repo.sample(rows, n) if n > 0 else []
        selected.extend(picked)
        strata.append(
            {
                "repo": repo,
                "available": len(rows),
                "selected": n
            }
        )

    rng.shuffle(selected)

    sample_id = f"swebench-{split}-n{target}-seed{seed}"
    payload_instances: list[dict[str, Any]] = []
    for idx, row in enumerate(selected, start=1):
        payload_instances.append(
            {
                "instance_id": row["instance_id"],
                "repo": row["repo"],
                "stratum": row["repo"],
                "instanceIndex": idx
            }
        )

    return {
        "dataset": dataset,
        "split": split,
        "seed": seed,
        "count": target,
        "sampleId": sample_id,
        "strata": strata,
        "instances": payload_instances
    }


def main() -> None:
    args = parse_args()
    if args.count < 1:
        raise ValueError("--count must be >= 1")

    instances = load_instances(args)
    sample = build_sample(instances, args.dataset, args.split, args.seed, args.count)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(sample, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output_path),
                "sampleId": sample["sampleId"],
                "count": sample["count"],
                "dataset": sample["dataset"],
                "split": sample["split"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
