"""
Load and save world state JSON files from the repo's /{userid}/ directory.
"""

from __future__ import annotations
import json
import os
from pathlib import Path
from .models import PlayerWorld, SharedWorld, Economy, BeliefIndex, Region

# Static region topology — lives in conspiracy-game/world/map.json (this repo).
MAP_PATH = Path(__file__).resolve().parent.parent / "static" / "world" / "map.json"


def _default_world_root() -> Path:
    # In CI: CONSPIRACY_WORLD_ROOT is set to $GITHUB_WORKSPACE (root of the
    # conspiracy repo checkout, where player dirs live at the top level).
    # Locally: fall back to ../world relative to this package for dev fixtures.
    env = os.environ.get('CONSPIRACY_WORLD_ROOT')
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "conspiracy"


WORLD_ROOT = _default_world_root()

# Static fields carried by map.json
_STATIC_FIELDS = {"id", "name", "adjacent_region_ids", "lon", "lat"}


def world_dir(userid: str) -> Path:
    return WORLD_ROOT / userid


def load_map() -> list[dict]:
    """Read static region descriptors from conspiracy-game/world/map.json."""
    return json.loads(MAP_PATH.read_text()) if MAP_PATH.exists() else []


def load_regions() -> list[dict]:
    """Merge static map data with dynamic region state into full Region dicts."""
    static_by_id = {r["id"]: r for r in load_map()}
    dynamic_f = WORLD_ROOT / "shared" / "regions.json"
    dynamic_list = json.loads(dynamic_f.read_text()) if dynamic_f.exists() else []
    dynamic_by_id = {r["id"]: r for r in dynamic_list}

    merged = []
    for rid, static in static_by_id.items():
        combined = {**static, **dynamic_by_id.get(rid, {})}
        merged.append(combined)
    return merged


def save_regions(regions) -> None:
    """Write only dynamic fields to conspiracy/shared/regions.json."""
    d = WORLD_ROOT / "shared"
    d.mkdir(parents=True, exist_ok=True)
    dynamic = [
        {k: v for k, v in r.model_dump().items() if k not in _STATIC_FIELDS}
        | {"id": r.id}
        for r in regions
    ]
    (d / "regions.json").write_text(json.dumps(dynamic, indent=2))


def load_player_world(userid: str) -> PlayerWorld:
    d = world_dir(userid)
    data: dict = {}
    for fname in ("heroes", "factions", "armies"):
        f = d / f"{fname}.json"
        data[fname] = json.loads(f.read_text()) if f.exists() else []
    data["regions"] = load_regions()

    for fname in ("economy", "belief"):
        f = d / f"{fname}.json"
        data[fname] = json.loads(f.read_text()) if f.exists() else {}

    turn_f = d / "turn.json"
    turn = json.loads(turn_f.read_text())["turn"] if turn_f.exists() else 0

    # supply defaults if files are missing
    if not data["economy"]:
        data["economy"] = Economy(owner=userid).model_dump()
    if not data["belief"]:
        data["belief"] = BeliefIndex(owner=userid).model_dump()

    return PlayerWorld(userid=userid, turn=turn, **data)


def save_player_world(world: PlayerWorld) -> None:
    d = world_dir(world.userid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "heroes.json").write_text(
        json.dumps([h.model_dump() for h in world.heroes], indent=2))
    (d / "factions.json").write_text(
        json.dumps([f.model_dump() for f in world.factions], indent=2))
    (d / "armies.json").write_text(
        json.dumps([a.model_dump() for a in world.armies], indent=2))
    (d / "economy.json").write_text(
        json.dumps(world.economy.model_dump(), indent=2))
    (d / "belief.json").write_text(
        json.dumps(world.belief.model_dump(), indent=2))
    (d / "turn.json").write_text(
        json.dumps({"turn": world.turn}, indent=2))


def load_shared_world() -> SharedWorld:
    f = WORLD_ROOT / "shared" / "world.json"
    if not f.exists():
        return SharedWorld()
    return SharedWorld(**json.loads(f.read_text()))


def save_shared_world(shared: SharedWorld) -> None:
    d = WORLD_ROOT / "shared"
    d.mkdir(parents=True, exist_ok=True)
    (d / "world.json").write_text(json.dumps(shared.model_dump(), indent=2))


def append_history(userid: str, entry: str) -> None:
    d = world_dir(userid) / "history"
    d.mkdir(parents=True, exist_ok=True)
    log = d / "events.log"
    with log.open("a") as f:
        f.write(entry + "\n")
