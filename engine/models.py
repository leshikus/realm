"""
World state schemas using pydantic.
All game objects are owned by a player (userid). Shared world state lives in /world/shared/.
"""

from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class FactionType(str, Enum):
    FEDERATION = "federation"       # citizens vote for gods
    SYNDICATE = "syndicate"         # corporations worship efficiency
    REALM = "realm"                 # monarchs rule out of habit


class DoctrineType(str, Enum):
    ATTRITION = "attrition"
    MANEUVER = "maneuver"
    SIEGE = "siege"
    RAID = "raid"


class HeroRole(str, Enum):
    AGENT = "agent"
    GENERAL = "general"
    DEMIGOD = "demigod"
    SCHOLAR = "scholar"


# ---------------------------------------------------------------------------
# Heroes
# ---------------------------------------------------------------------------

class SkillGraph(BaseModel):
    combat: int = 0
    diplomacy: int = 0
    espionage: int = 0
    scholarship: int = 0
    leadership: int = 0


class PersonalityMatrix(BaseModel):
    loyalty: int = Field(50, ge=0, le=100)
    paranoia: int = Field(0, ge=0, le=100)
    ambition: int = Field(50, ge=0, le=100)
    competence: int = Field(50, ge=0, le=100)
    # vices accumulate through failure
    vices: list[str] = Field(default_factory=list)


class Hero(BaseModel):
    id: str
    name: str
    owner: str                          # userid
    role: HeroRole
    skills: SkillGraph = Field(default_factory=SkillGraph)
    personality: PersonalityMatrix = Field(default_factory=PersonalityMatrix)
    region_id: Optional[str] = None
    alive: bool = True
    turn_created: int = 0


# ---------------------------------------------------------------------------
# Factions
# ---------------------------------------------------------------------------

class Faction(BaseModel):
    id: str
    name: str
    owner: str                          # userid
    type: FactionType
    influence: int = Field(50, ge=0, le=100)
    economy: int = Field(50, ge=0, le=100)
    crime: int = Field(0, ge=0, le=100)
    ideology_stability: int = Field(50, ge=0, le=100)


# ---------------------------------------------------------------------------
# Regions
# ---------------------------------------------------------------------------

class Region(BaseModel):
    id: str
    name: str
    owner: str                          # userid
    adjacent_region_ids: list[str] = Field(default_factory=list)
    population: int = 1000
    prosperity: int = Field(50, ge=0, le=100)
    unrest: int = Field(0, ge=0, le=100)
    controlling_faction_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Economy
# ---------------------------------------------------------------------------

class Economy(BaseModel):
    owner: str
    trust: int = Field(100, ge=0)       # primary currency
    output_per_turn: int = 10
    consumption_per_turn: int = 8
    propaganda_bonus: int = 0           # added to trust generation


# ---------------------------------------------------------------------------
# Belief
# ---------------------------------------------------------------------------

class BeliefIndex(BaseModel):
    owner: str
    aggregate: int = Field(70, ge=0, le=100)    # drives resource availability
    # per-domain belief levels
    agriculture: int = Field(70, ge=0, le=100)
    military: int = Field(70, ge=0, le=100)
    governance: int = Field(70, ge=0, le=100)


# ---------------------------------------------------------------------------
# Army
# ---------------------------------------------------------------------------

class Army(BaseModel):
    id: str
    name: str
    owner: str
    region_id: str
    commander_hero_id: Optional[str] = None
    doctrine: DoctrineType = DoctrineType.ATTRITION
    strength: int = Field(100, ge=0)
    morale: int = Field(80, ge=0, le=100)
    economy_upkeep_per_turn: int = 5


# ---------------------------------------------------------------------------
# Player world state (everything under /{userid}/)
# ---------------------------------------------------------------------------

class PlayerWorld(BaseModel):
    userid: str
    turn: int = 0
    heroes: list[Hero] = Field(default_factory=list)
    factions: list[Faction] = Field(default_factory=list)
    regions: list[Region] = Field(default_factory=list)
    economy: Economy
    belief: BeliefIndex
    armies: list[Army] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Shared world state (under /world/shared/)
# ---------------------------------------------------------------------------

class SharedWorld(BaseModel):
    current_turn: int = 0
    turn_deadline_utc: Optional[str] = None    # ISO 8601
    player_ids: list[str] = Field(default_factory=list)
