"""
Load and save world state JSON files from the repo's /{userid}/ directory.
"""

from __future__ import annotations
import json
from pathlib import Path
from .models import PlayerWorld, SharedWorld, Economy, BeliefIndex


WORLD_ROOT = Path(__file__).resolve().parent.parent / "world"


def world_dir(userid: str) -> Path:
    return WORLD_ROOT / userid


def load_player_world(userid: str) -> PlayerWorld:
    d = world_dir(userid)
    data: dict = {}
    for fname in ("heroes", "factions", "regions", "armies"):
        f = d / f"{fname}.json"
        data[fname] = json.loads(f.read_text()) if f.exists() else []

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
    (d / "regions.json").write_text(
        json.dumps([r.model_dump() for r in world.regions], indent=2))
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
