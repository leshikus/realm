"""
CLI entry point for the simulation engine.
Called by CI:
    python -m engine.main <userid> <turn>

Reads:  world/<userid>/**/*.json  +  world/<userid>/orders/turn.json
Writes: world/<userid>/**/*.json  +  world/<userid>/history/events.log
Exits:  0 on success, 1 on validation failure (CI will reject the PR).
"""

from __future__ import annotations
import sys
import json
from datetime import datetime, timezone

from .loader import load_player_world, save_player_world, save_regions, append_history, world_dir
from .orders import load_orders, validate_orders
from .simulation import resolve_turn


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python -m engine.main <userid> <turn>", file=sys.stderr)
        sys.exit(1)

    userid = sys.argv[1]
    turn   = int(sys.argv[2])

    # Load
    world  = load_player_world(userid)
    orders = load_orders(userid, turn)

    # Validate
    errors = validate_orders(orders, world)
    if errors:
        print("ORDER VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)

    # Resolve
    result = resolve_turn(world, orders, seed=turn)

    # Persist
    save_player_world(result.world)
    save_regions(result.world.regions)

    # Write history
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    header = f"\n=== Turn {turn} resolved at {ts} ==="
    append_history(userid, header)
    for event in result.events:
        append_history(userid, f"  {event}")

    # Write stats snapshot for the client's Statistics panel
    _write_stats_snapshot(userid, turn, result.world)

    # Print turn summary (becomes the git commit message body in CI)
    print(f"Turn {turn} resolved. {len(result.events)} events.")
    for event in result.events:
        print(f"  {event}")


def _write_stats_snapshot(userid: str, turn: int, world) -> None:
    """Write a per-turn stats JSON file read by the browser Statistics panel."""
    avg_unrest = (
        sum(r.unrest for r in world.regions) // max(1, len(world.regions))
        if world.regions else 0
    )
    total_strength = sum(a.strength for a in world.armies)
    snapshot = {
        "turn":          turn,
        "trust":         world.economy.trust,
        "belief":        world.belief.aggregate,
        "army_strength": total_strength,
        "unrest":        avg_unrest,
    }
    stats_dir = world_dir(userid) / "history"
    stats_dir.mkdir(parents=True, exist_ok=True)
    (stats_dir / f"stats_{turn:04d}.json").write_text(
        json.dumps(snapshot, indent=2)
    )


if __name__ == "__main__":
    main()
