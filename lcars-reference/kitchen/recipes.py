"""JARVIS unified recipe API: local store + MealDB web search.

The MealDB engine (web_recipes) is carried over unchanged from the original
J.A.R.V.I.S kitchen system, so search quality and filtering behave identically.
"""

from server.kitchen import web_recipes
from server.kitchen import store


# The original engine returns a list of recipe dicts (web=True) and sometimes
# stores extra keys we don't want to persist. Keep our serialization consistent.


def search_local(query="", category=""):
    """Search saved recipes by query and optional category."""
    recipes = store.all_recipes()
    q = (query or "").strip().lower()
    cat = (category or "").strip().lower()

    results = []

    for recipe in recipes:
        if cat and (recipe.get("category") or "").strip().lower() != cat:
            continue

        if not q:
            results.append(recipe)
            continue

        haystack = " ".join((
            recipe.get("name", ""),
            recipe.get("category", ""),
            recipe.get("description", ""),
            " ".join(recipe.get("ingredients", [])),
        )).lower()

        if q in haystack:
            results.append(recipe)

    return results


def web_search(query, limit=20):
    """Run the MealDB web-recipe search, returning web=True recipe dicts."""
    raw = web_recipes.search_recipes(str(query or "").strip())

    results = []

    for recipe in raw[:limit]:
        results.append({
            "id": str(recipe.get("id", "")),
            "name": recipe.get("name", "Recipe"),
            "category": recipe.get("category", "Recipe"),
            "description": recipe.get("description", ""),
            "ingredients": recipe.get("ingredients", []),
            "instructions": recipe.get("instructions", []),
            "image": recipe.get("image", ""),
            "favorite": False,
            "web": True,
        })

    return results


def categories():
    """Distinct local categories for the kitchen category shelf."""
    seen = set()
    ordered = []

    for recipe in store.all_recipes():
        cat = recipe.get("category") or "Recipe"
        key = cat.lower()

        if key not in seen:
            seen.add(key)
            ordered.append(cat)

    return ordered