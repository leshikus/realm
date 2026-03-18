"""
Order schemas and validator.
A turn's orders file lives at /{userid}/orders/turn_N_orders.json.
"""

from __future__ import annotations
import json
from pathlib import Path
from enum import Enum
from typing import Optional, Any
from pydantic import BaseModel, model_validator

from .models import PlayerWorld
from .loader import world_dir


class OrderType(str, Enum):
    # Administrative
    SET_PROPAGANDA     = "set_propaganda"       # adjust propaganda bonus
    LEVY_TAX           = "levy_tax"             # raise trust, increase unrest
    # Heroic
    ASSIGN_HERO        = "assign_hero"          # assign hero to region/army
    RECRUIT_HERO       = "recruit_hero"         # create new hero (costs trust)
    # Military
    ARMY_DIRECTIVE     = "army_directive"       # issue strategic directive to army
    RAISE_ARMY         = "raise_army"           # recruit new army in region (costs trust)
    # Research
    BEGIN_RESEARCH     = "begin_research"       # assign scholars to a tech
    # Infrastructure
    BUILD              = "build"                # construct in region


class Order(BaseModel):
    type: OrderType
    params: dict[str, Any] = {}

    @model_validator(mode="after")
    def check_params(self) -> "Order":
        required: dict[OrderType, list[str]] = {
            OrderType.SET_PROPAGANDA:  ["faction_id", "value"],
            OrderType.LEVY_TAX:        ["region_id", "amount"],
            OrderType.ASSIGN_HERO:     ["hero_id", "target_id"],
            OrderType.RECRUIT_HERO:    ["name", "role", "region_id"],
            OrderType.ARMY_DIRECTIVE:  ["army_id", "directive"],
            OrderType.RAISE_ARMY:      ["name", "region_id", "doctrine"],
            OrderType.BEGIN_RESEARCH:  ["scholar_hero_id", "tech"],
            OrderType.BUILD:           ["region_id", "structure"],
        }
        missing = [k for k in required.get(self.type, []) if k not in self.params]
        if missing:
            raise ValueError(f"Order {self.type} missing params: {missing}")
        return self


class TurnOrders(BaseModel):
    userid: str
    turn: int
    orders: list[Order] = []


class ValidationError(Exception):
    pass


def load_orders(userid: str, turn: int) -> TurnOrders:
    f = world_dir(userid) / "orders" / f"turn_{turn:04d}_orders.json"
    if not f.exists():
        return TurnOrders(userid=userid, turn=turn, orders=[])
    raw = json.loads(f.read_text())
    return TurnOrders(**raw)


def validate_orders(orders: TurnOrders, world: PlayerWorld) -> list[str]:
    """
    Returns a list of error strings. Empty list = valid.
    Checks ownership, resource availability, and basic rule constraints.
    """
    errors: list[str] = []
    hero_ids = {h.id for h in world.heroes}
    army_ids = {a.id for a in world.armies}
    region_ids = {r.id for r in world.regions}
    faction_ids = {f.id for f in world.factions}

    trust = world.economy.trust
    trust_spent = 0

    for i, order in enumerate(orders.orders):
        p = order.params
        tag = f"Order[{i}] {order.type}"

        if order.type == OrderType.ASSIGN_HERO:
            if p["hero_id"] not in hero_ids:
                errors.append(f"{tag}: unknown hero '{p['hero_id']}'")

        elif order.type == OrderType.RECRUIT_HERO:
            cost = 20
            trust_spent += cost
            if p["region_id"] not in region_ids:
                errors.append(f"{tag}: unknown region '{p['region_id']}'")

        elif order.type == OrderType.ARMY_DIRECTIVE:
            if p["army_id"] not in army_ids:
                errors.append(f"{tag}: unknown army '{p['army_id']}'")

        elif order.type == OrderType.RAISE_ARMY:
            cost = 30
            trust_spent += cost
            if p["region_id"] not in region_ids:
                errors.append(f"{tag}: unknown region '{p['region_id']}'")

        elif order.type == OrderType.SET_PROPAGANDA:
            if p["faction_id"] not in faction_ids:
                errors.append(f"{tag}: unknown faction '{p['faction_id']}'")
            if not (0 <= int(p["value"]) <= 50):
                errors.append(f"{tag}: propaganda value must be 0–50")

        elif order.type == OrderType.LEVY_TAX:
            if p["region_id"] not in region_ids:
                errors.append(f"{tag}: unknown region '{p['region_id']}'")

    if trust_spent > trust:
        errors.append(
            f"Insufficient trust: orders require {trust_spent}, player has {trust}"
        )

    return errors
