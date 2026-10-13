"""
Local recipe store (JSON file, stdlib only).

Consolidates the two original projects: the food/SQLite flavour of C:\\JARVIS
and the JSON-based kitchen of J.A.R.V.I.S, now one portable JSON list shared by
every client (desktop, Pi 2, watch, phone web app).
"""
import json
import os
import threading
import time
from pathlib import Path

KITCHEN_DIR = Path(__file__).resolve().parent
RECIPES_FILE = Path(os.environ.get(
    "JARVIS_RECIPES",
    KITCHEN_DIR / "recipes.json",
))

_lock = threading.Lock()


def store_path():
    return RECIPES_FILE


def ensure_store_dir():
    RECIPES_FILE.parent.mkdir(parents=True, exist_ok=True)


def _read():
    if not RECIPES_FILE.exists():
        return []
    try:
        with open(RECIPES_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write(recipes):
    RECIPES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RECIPES_FILE, "w", encoding="utf-8") as file:
        json.dump(recipes, file, indent=2)


def _serialize(recipe):
    return {
        "id": recipe.get("id", recipe.get("_id", "")),
        "name": str(recipe.get("name", "Untitled Recipe")),
        "category": str(recipe.get("category", "Recipe")),
        "ingredients": list(recipe.get("ingredients", [])) + [
            str(recipe["ingredients"])
        ] if isinstance(recipe.get("ingredients"), str) else
        list(recipe.get("ingredients", [])),
        "instructions": list(recipe.get("instructions", [])) + [
            str(recipe["instructions"])
        ] if isinstance(recipe.get("instructions"), str) else
        list(recipe.get("instructions", [])),
        "description": str(recipe.get("description", "")),
        "image": str(recipe.get("image", "")),
        "favorite": bool(recipe.get("favorite", False)),
        "web": bool(recipe.get("web", False)),
    }


def all_recipes():
    with _lock:
        return [_serialize(r) for r in _read()]


def favorites():
    with _lock:
        return [r for r in (_serialize(x) for x in _read()) if r["favorite"]]


def find(recipe_id):
    with _lock:
        for recipe in _read():
            if str(recipe.get("id")) == str(recipe_id):
                return _serialize(recipe)
    return None


def add(data):
    """Add a recipe (or replace one with matching id/name). Returns the record."""
    recipe_id = str(int(time.time() * 1000))
    record = {
        "id": recipe_id,
        "name": str((data or {}).get("name", "")).strip() or "Untitled",
        "category": str((data or {}).get("category", "Recipe")).strip(),
        "description": str((data or {}).get("description", "")).strip(),
        "ingredients": list((data or {}).get("ingredients", [])) or [],
        "instructions": list((data or {}).get("instructions", [])) or [],
        "image": str((data or {}).get("image", "")).strip(),
        "favorite": False,
    }

    with _lock:
        recipes = _read()
        # Rebuild empty ingredient strings to single strings for simplicity.
        if not record["ingredients"] and (data or {}).get("ingredients_text"):
            record["ingredients"] = [
                line.strip() for line in str(
                    data.get("ingredients_text")
                ).splitlines() if line.strip()
            ]
        recipes.append(record)
        _write(recipes)

    return _serialize(record)


def set_favorite(recipe_id, favorite=True):
    return update(recipe_id, {"favorite": favorite})


def update(recipe_id, data):
    """Update selected fields of an existing recipe. Returns updated record."""
    with _lock:
        recipes = _read()
        for recipe in recipes:
            if str(recipe.get("id")) == str(recipe_id):
                allowed = {
                    "name", "category", "description", "ingredients",
                    "instructions", "image", "favorite",
                }
                for key, value in (data or {}).items():
                    if key not in allowed:
                        continue
                    if key in ("ingredients", "instructions"):
                        recipe[key] = list(value or [])
                    elif key == "favorite":
                        recipe[key] = bool(value)
                    else:
                        recipe[key] = str(value or "")
                _write(recipes)
                return _serialize(recipe)
    return None


def remove(recipe_id):
    with _lock:
        recipes = _read()
        remaining = [
            r for r in recipes if str(r.get("id")) != str(recipe_id)
        ]
        if len(remaining) != len(recipes):
            _write(remaining)
            return True
    return False