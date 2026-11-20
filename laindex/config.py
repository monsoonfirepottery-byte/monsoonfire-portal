from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class LocationConfig(BaseModel):
    state: str = "AZ"
    east_boundary_longitude: float | None = -112.05
    allowed_cities: list[str] = Field(default_factory=lambda: ["Surprise", "Peoria", "Glendale", "Phoenix", "Goodyear", "Avondale", "Tolleson"])
    denied_cities: list[str] = Field(default_factory=lambda: ["Mesa", "Gilbert", "Chandler", "Queen Creek", "Tempe", "Scottsdale"])


class LimitsConfig(BaseModel):
    max_all_in: float = 100
    estimated_tax_percent: float = 9.2


class PickupConfig(BaseModel):
    start: date = date(2026, 9, 10)
    end: date = date(2026, 9, 12)


class Config(BaseModel):
    database: Path = Path("laindex-data/index.sqlite3")
    user_agent: str = "MonsoonFire-LAIndex/0.1 (personal local index)"
    request_delay_seconds: float = 2
    cache_ttl_hours: int = 12
    location: LocationConfig = Field(default_factory=LocationConfig)
    limits: LimitsConfig = Field(default_factory=LimitsConfig)
    pickup: PickupConfig = Field(default_factory=PickupConfig)
    hunts: dict[str, dict[str, dict[str, int]]] = Field(default_factory=dict)

    @classmethod
    def load(cls, path: Path | str = "config.yaml") -> "Config":
        path = Path(path)
        if not path.exists():
            example = Path("config.example.yaml")
            return cls.model_validate(yaml.safe_load(example.read_text()) if example.exists() else {})
        return cls.model_validate(yaml.safe_load(path.read_text()) or {})

    def override(self, **values: Any) -> "Config":
        return self.model_copy(update=values)
