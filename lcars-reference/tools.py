"""
JARVIS tool registry for the web backend.

Re-implements the tools from the original PySide6 client (tools/basic.py) but
hosted by whatever machine runs the web server. Tools execute against the
*server host*, which is the machine this server process runs on.
"""
import json
import os
import re
import subprocess
import webbrowser
from datetime import datetime
from pathlib import Path

from server import audit
from server import events
from server import config as server_config
from server.kitchen import recipes as kitchen
from server.kitchen import store as recipe_store

PROJECT_ROOT = Path(__file__).resolve().parent.parent
APPS_PATH = Path(os.environ.get(
    "JARVIS_APPS",
    PROJECT_ROOT / "config" / "apps.json",
))


def get_time():
    return datetime.now().strftime("%I:%M %p")


def get_status():
    return "Cloud JARVIS core: ONLINE"


# ------------------------------------------------------------------
# Recipe / Nutrition tools
# ------------------------------------------------------------------
def search_recipes(query="", source="local"):
    """Search local recipes and optionally MealDB web recipes.

    source can be 'local', 'web', or 'both'.
    Returns a compact list of matching recipe names/ids.
    """
    query = (query or "").strip()
    source = (source or "local").strip().lower()

    results = []
    if source in ("local", "both"):
        results.extend(kitchen.search_local(query))
    if source in ("web", "both"):
        try:
            results.extend(kitchen.web_search(query))
        except Exception as exc:
            if source == "web":
                return f"Web recipe search failed: {exc}"

    if not results:
        return f"No recipes found for '{query}'."

    lines = []
    for r in results[:20]:
        name = r.get("name", "Untitled")
        rid = r.get("id", "")
        cat = r.get("category", "Recipe")
        fav = " ★" if r.get("favorite") else ""
        web = " (web)" if r.get("web") else ""
        lines.append(f"- {name} [{cat}]{fav}{web} (id: {rid})")
    return "\n".join(lines)


def get_recipe(recipe_id, full=False):
    """Return recipe details by id. By default returns a concise summary.

    Set full=True to receive the complete ingredient list and instructions.
    """
    recipe_id = str(recipe_id or "").strip()
    if not recipe_id:
        return "Tool rejected: no recipe id provided."

    recipe = recipe_store.find(recipe_id)
    if recipe is None:
        return f"Recipe '{recipe_id}' not found."

    name = recipe.get("name", "Untitled")
    category = recipe.get("category", "Recipe")
    desc = recipe.get("description", "")
    favorite = " ★" if recipe.get("favorite") else ""

    ingredients = recipe.get("ingredients") or []
    instructions = recipe.get("instructions") or recipe.get("method") or []

    lines = [f"**{name}**{favorite}", f"Category: {category}"]
    if desc:
        lines.append(desc)
    lines.append(f"Ingredients: {len(ingredients)} items")
    lines.append(f"Steps: {len(instructions)}")

    if full:
        if ingredients:
            lines.append("Ingredients:")
            for item in ingredients:
                lines.append(f"- {item}")
        if instructions:
            lines.append("Instructions:")
            for i, step in enumerate(instructions, 1):
                lines.append(f"{i}. {step}")
    else:
        lines.append("Respond with a brief summary only; do not list every ingredient or step unless the user asks for the full recipe.")

    return "\n".join(lines)


def add_recipe(name, category="Recipe", ingredients=None, instructions=None,
               description=""):
    """Add a new recipe to the local kitchen store."""
    name = (name or "").strip()
    if not name:
        return "Tool rejected: recipe name is required."

    try:
        recipe_store.ensure_store_dir()
        record = recipe_store.add({
            "name": name,
            "category": category or "Recipe",
            "description": description or "",
            "ingredients": list(ingredients or []),
            "instructions": list(instructions or []),
        })
        audit.file_operation("write", recipe_store.store_path(), source_ip=None)
        return f"Added recipe '{record.get('name')}' (id: {record.get('id')})."
    except Exception as exc:
        audit.security_violation("recipe write blocked", details=str(exc))
        return f"Could not add recipe: {exc}"


def set_favorite(recipe_id, favorite=True):
    """Mark a local recipe as favorite or remove favorite status."""
    recipe_id = str(recipe_id or "").strip()
    if not recipe_id:
        return "Tool rejected: recipe id is required."

    try:
        recipe_store.ensure_store_dir()
        record = recipe_store.set_favorite(recipe_id, bool(favorite))
        audit.file_operation("write", recipe_store.store_path(), source_ip=None)
        if record is None:
            return f"Recipe '{recipe_id}' not found."
        status = "favorite" if record.get("favorite") else "not favorite"
        return f"'{record.get('name')}' is now {status}."
    except Exception as exc:
        audit.security_violation("recipe write blocked", details=str(exc))
        return f"Could not update recipe: {exc}"


# ------------------------------------------------------------------
# Recipe scaling
# ------------------------------------------------------------------
def scale_recipe(recipe_id, factor):
    """Scale a local recipe's ingredients by a factor and return the adjusted list."""
    recipe_id = str(recipe_id or "").strip()
    if not recipe_id:
        return "Tool rejected: no recipe id provided."

    recipe = recipe_store.find(recipe_id)
    if recipe is None:
        return f"Recipe '{recipe_id}' not found."

    try:
        factor = float(factor)
    except (TypeError, ValueError):
        return "Tool rejected: factor must be a number."

    name = recipe.get("name", "Untitled")
    ingredients = recipe.get("ingredients") or []
    lines = [f"Scaled **{name}** by {factor:g}x"]

    def _scale_amount(text):
        """Find a leading numeric amount (whole, fraction, or mixed) and scale it."""
        # Try mixed number first (e.g. "1 1/2" or "1-1/2"), then simple fraction, then decimal/whole.
        match = re.match(
            r"^\s*(?:(\d+(?:\.\d+)?))(?:\s+|-)(?:(\d+)\s*/\s*(\d+))\s*(.*)",
            text,
        )
        if not match:
            match = re.match(
                r"^\s*(?:(\d+)\s*/\s*(\d+))\s*(.*)",
                text,
            )
        if not match:
            match = re.match(
                r"^\s*(?:(\d+(?:\.\d+)?))\s*(.*)",
                text,
            )
        if not match:
            return text

        groups = match.groups()
        value = 0.0
        rest = ""
        if len(groups) == 4:
            # mixed: whole, num, den, rest
            whole_s, num_s, den_s, rest = groups
            value = float(whole_s) + float(num_s) / float(den_s)
        elif len(groups) == 3:
            # simple fraction: num, den, rest
            num_s, den_s, rest = groups
            value = float(num_s) / float(den_s)
        else:
            # whole/decimal: amount, rest
            whole_s, rest = groups
            value = float(whole_s)

        scaled = value * factor
        # Format nicely: use integer when close, otherwise 2 decimals trimmed.
        if abs(scaled - round(scaled)) < 0.02:
            amount = str(int(round(scaled)))
        else:
            amount = f"{scaled:.2f}".rstrip("0").rstrip(".")
        rest = rest.strip()
        if rest:
            return f"{amount} {rest}"
        return amount

    if not ingredients:
        lines.append("No ingredients to scale.")
    else:
        for item in ingredients:
            lines.append(f"- {_scale_amount(item)}")

    return "\n".join(lines)


# ------------------------------------------------------------------
# Volume control (browser-side)
# ------------------------------------------------------------------
def set_volume(level):
    """Set playback volume to a level between 0.0 and 1.0."""
    try:
        level = max(0.0, min(1.0, float(level)))
    except (TypeError, ValueError):
        return "Tool rejected: volume level must be a number between 0 and 1."
    events.post("volume", action="set", level=level)
    percent = int(level * 100)
    return f"Volume set to {percent}%."


def volume_up():
    """Raise playback volume by 10%."""
    events.post("volume", action="up", delta=0.1)
    return "Volume increased."


def volume_down():
    """Lower playback volume by 10%."""
    events.post("volume", action="down", delta=0.1)
    return "Volume decreased."


def mute_volume():
    """Toggle playback mute."""
    events.post("volume", action="mute")
    return "Volume muted/unmuted."


# ------------------------------------------------------------------
# Kitchen unit conversions
# ------------------------------------------------------------------
_UNIT_FACTORS = {
    # Volume: all expressed relative to 1 millilitre
    "ml": 1.0, "milliliter": 1.0, "millilitre": 1.0,
    "l": 1000.0, "liter": 1000.0, "litre": 1000.0,
    "tsp": 4.92892, "teaspoon": 4.92892,
    "tbsp": 14.7868, "tablespoon": 14.7868,
    "fl oz": 29.5735, "fluid ounce": 29.5735,
    "cup": 236.588, "cups": 236.588,
    "pint": 473.176, "pt": 473.176,
    "quart": 946.353, "qt": 946.353,
    "gallon": 3785.41, "gal": 3785.41,
    # Mass: all expressed relative to 1 gram
    "g": 1.0, "gram": 1.0,
    "kg": 1000.0, "kilogram": 1000.0, "kilogramme": 1000.0,
    "oz": 28.3495, "ounce": 28.3495,
    "lb": 453.592, "pound": 453.592,
}


def convert_units(quantity, from_unit, to_unit):
    """Convert a quantity from one kitchen unit to another."""
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return "Tool rejected: quantity must be a number."

    from_unit = (from_unit or "").strip().lower()
    to_unit = (to_unit or "").strip().lower()

    if not from_unit or not to_unit:
        return "Tool rejected: both from_unit and to_unit are required."

    from_factor = _UNIT_FACTORS.get(from_unit)
    to_factor = _UNIT_FACTORS.get(to_unit)

    if from_factor is None:
        return f"Unknown unit '{from_unit}'."
    if to_factor is None:
        return f"Unknown unit '{to_unit}'."

    volume_units = {"ml", "milliliter", "millilitre", "l", "liter", "litre",
                    "tsp", "teaspoon", "tbsp", "tablespoon", "fl oz", "fluid ounce",
                    "cup", "cups", "pint", "pt", "quart", "qt", "gallon", "gal"}
    mass_units = {"g", "gram", "kg", "kilogram", "kilogramme", "oz", "ounce", "lb", "pound"}

    if (from_unit in volume_units and to_unit not in volume_units) or \
       (from_unit in mass_units and to_unit not in mass_units):
        return f"Can't convert between {from_unit} and {to_unit}: different measurement types."

    base_value = quantity * from_factor
    converted = base_value / to_factor

    if abs(converted - round(converted)) < 0.02:
        result = str(int(round(converted)))
    else:
        result = f"{converted:.2f}".rstrip("0").rstrip(".")

    return f"{quantity:g} {from_unit} = {result} {to_unit}."


# ------------------------------------------------------------------
# Training Wheels Protocol
# ------------------------------------------------------------------
def _training_wheels_state():
    """Return (enabled, unlocked) from current config."""
    try:
        cfg = server_config.load()
    except Exception:
        return False, False
    tw = cfg.get("training_wheels", {})
    return bool(tw.get("enabled", False)), bool(tw.get("unlocked", False))


def unlock_jarvis(password):
    """Unlock JARVIS out of Training Wheels Protocol with the configured password."""
    enabled, _ = _training_wheels_state()
    if not enabled:
        return "Training Wheels Protocol is not enabled, so no unlock is needed."

    cfg = server_config.load()
    expected = str(cfg.get("training_wheels", {}).get("password", ""))
    if not expected:
        return "No unlock password is configured."

    if str(password or "") == expected:
        server_config.save({"training_wheels": {"unlocked": True}})
        audit.training_wheels("unlock", True)
        return "Training Wheels Protocol disabled for this session. Full access granted."
    audit.training_wheels("unlock", False)
    return "Incorrect password. Training Wheels Protocol remains active."


def verify_password(password):
    """Check a password against the Training Wheels Protocol password."""
    cfg = server_config.load()
    expected = str(cfg.get("training_wheels", {}).get("password", ""))
    if not expected:
        return False
    return str(password or "") == expected


def lock_jarvis():
    """Re-enable Training Wheels Protocol."""
    enabled, _ = _training_wheels_state()
    if not enabled:
        return "Training Wheels Protocol is not enabled."
    server_config.save({"training_wheels": {"unlocked": False}})
    audit.training_wheels("lock", True)
    return "Training Wheels Protocol re-engaged. Restricted mode active."


# ------------------------------------------------------------------
# App / website tools
# ------------------------------------------------------------------
def _load_apps():
    if not APPS_PATH.exists():
        return {}
    with open(APPS_PATH, "r", encoding="utf-8") as file:
        return json.load(file)


def open_app(name, host_tools=True):
    if not host_tools:
        return ("Tool disabled: host applications are turned off in config. "
                "The assistant likely isn't running on the same OS as your apps.")

    name = (name or "").strip().lower()
    apps = _load_apps()

    if not name:
        return "Tool rejected: no application was specified."

    if name not in apps:
        approved = ", ".join(apps.keys())
        return f"I can't open '{name}'. Approved applications: {approved}."

    target = os.path.expandvars(apps[name])

    try:
        subprocess.Popen([target])
        return f"Opening {name}."
    except FileNotFoundError:
        return f"I couldn't find {name} at: {target}"
    except OSError as error:
        return f"I couldn't open {name}: {error}"


def open_website(url):
    url = (url or "").strip()
    if not url:
        return "Tool rejected: no website was specified."
    if not url.startswith(("https://", "http://")):
        url = "https://" + url
    webbrowser.open(url)
    return f"Opening {url}."


# Registered tool names / handlers.
HANDLERS = {
    "get_time": get_time,
    "get_status": get_status,
    "search_recipes": search_recipes,
    "get_recipe": get_recipe,
    "scale_recipe": scale_recipe,
    "add_recipe": add_recipe,
    "set_favorite": set_favorite,
    "set_volume": set_volume,
    "volume_up": volume_up,
    "volume_down": volume_down,
    "mute_volume": mute_volume,
    "convert_units": convert_units,
    "unlock_jarvis": unlock_jarvis,
    "verify_password": verify_password,
    "lock_jarvis": lock_jarvis,
    "open_app": open_app,
    "open_website": open_website,
}


# Tools that perform actions on the server host.
HOST_ACTION_TOOLS = {
    "open_app",
    "open_website",
}

# Tools allowed while Training Wheels Protocol is active.
SAFE_TOOLS = {
    "get_time",
    "get_status",
    "search_recipes",
    "get_recipe",
    "scale_recipe",
    "convert_units",
    "set_volume",
    "volume_up",
    "volume_down",
    "mute_volume",
    "unlock_jarvis",
    "lock_jarvis",
}


def _is_path_in_list(target: Path, path_list):
    """Return True if target is within any path in path_list."""
    try:
        resolved = target.resolve()
    except OSError:
        return False
    for p in path_list:
        try:
            base = Path(p).resolve()
        except OSError:
            continue
        if resolved == base or str(resolved).startswith(str(base) + os.sep):
            return True
    return False


def _is_path_denied(target: Path):
    cfg = server_config.load()
    denied = [p for p in cfg.get("security", {}).get("denied_paths", []) if p]
    return _is_path_in_list(target, denied)


def _is_path_allowed(target: Path):
    """Return True if target is within an allowed writable path."""
    cfg = server_config.load()
    allowed = [p for p in cfg.get("security", {}).get("allowed_paths", []) if p]
    return not _is_path_denied(target) and _is_path_in_list(target, allowed)


def _is_path_readable(target: Path):
    """Return True if target is within an allowed or read-only path."""
    cfg = server_config.load()
    allowed = [p for p in cfg.get("security", {}).get("allowed_paths", []) if p]
    read_only = [p for p in cfg.get("security", {}).get("read_only_paths", []) if p]
    return not _is_path_denied(target) and (
        _is_path_in_list(target, allowed) or _is_path_in_list(target, read_only)
    )


def _enforce_path(target, write=True):
    """Raise ValueError if a file path violates the sandbox policy."""
    path = Path(target)
    if not path.is_absolute():
        raise ValueError(f"Relative paths are not allowed: {target}")
    if _is_path_denied(path):
        raise ValueError(f"Path is denied by JARVIS security policy: {target}")
    if write:
        if not _is_path_allowed(path):
            raise ValueError(f"Path is outside the JARVIS writable sandbox: {target}")
    else:
        if not _is_path_readable(path):
            raise ValueError(f"Path is outside the JARVIS readable sandbox: {target}")
    return path


def execute(name, arguments, host_tools=True, source_ip=None):
    """Run one approved tool, returning a human-readable result string."""
    args = arguments or {}

    enabled, unlocked = _training_wheels_state()
    locked = enabled and not unlocked

    if name not in HANDLERS:
        audit.tool_call(name, args, "", locked, host_tools, allowed=False,
                        error="tool not in allow-list")
        return f"Tool rejected: '{name}' is not an approved JARVIS tool."

    if locked and name not in SAFE_TOOLS:
        audit.tool_call(name, args, "", locked, host_tools, allowed=False,
                        error="training wheels locked")
        return f"Tool blocked: '{name}' is not available while Training Wheels Protocol is active."

    if not host_tools and name in HOST_ACTION_TOOLS:
        audit.tool_call(name, args, "", locked, host_tools, allowed=False,
                        error="host_tools disabled")
        return ("Tool disabled: host applications are turned off in config. "
                "The assistant likely isn't running on the same OS as your apps.")

    try:
        if name == "get_time":
            result = get_time()
        elif name == "get_status":
            result = get_status()
        elif name == "search_recipes":
            result = search_recipes(args.get("query"), args.get("source", "local"))
        elif name == "get_recipe":
            result = get_recipe(args.get("recipe_id"), args.get("full", False))
        elif name == "scale_recipe":
            result = scale_recipe(args.get("recipe_id"), args.get("factor", 1))
        elif name == "add_recipe":
            result = add_recipe(
                args.get("name"),
                args.get("category", "Recipe"),
                args.get("ingredients"),
                args.get("instructions"),
                args.get("description", ""),
            )
        elif name == "set_favorite":
            result = set_favorite(args.get("recipe_id"), args.get("favorite", True))
        elif name == "set_volume":
            result = set_volume(args.get("level"))
        elif name == "volume_up":
            result = volume_up()
        elif name == "volume_down":
            result = volume_down()
        elif name == "mute_volume":
            result = mute_volume()
        elif name == "convert_units":
            result = convert_units(args.get("quantity"), args.get("from_unit"), args.get("to_unit"))
        elif name == "unlock_jarvis":
            result = unlock_jarvis(args.get("password"))
        elif name == "verify_password":
            result = verify_password(args.get("password"))
        elif name == "lock_jarvis":
            result = lock_jarvis()
        elif name == "open_app":
            result = open_app(args.get("name", ""), host_tools)
        elif name == "open_website":
            result = open_website(args.get("url", ""))
        else:
            audit.tool_call(name, args, "", locked, host_tools, allowed=False,
                            error="unreachable handler")
            return f"Tool rejected: '{name}' is not an approved JARVIS tool."

        audit.tool_call(name, args, result, locked, host_tools, allowed=True)
        return result
    except Exception as exc:
        audit.tool_call(name, args, "", locked, host_tools, allowed=True,
                        error=str(exc))
        return f"Tool error: {exc}"


def oauth_openapi(locked=False):
    """OpenAPI-style tool definitions passed to the model.

    When Training Wheels Protocol is locked, only SAFE_TOOLS are advertised.
    """
    all_definitions = [
        {
            "type": "function",
            "function": {
                "name": "get_time",
                "description": "Get the current local time.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_status",
                "description": "Get the current status of the JARVIS core.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_recipes",
                "description": "Search the JARVIS kitchen for recipes by name, category, or ingredient. Use source='web' for MealDB online recipes or 'both' for local + web.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string",
                                  "description": "Search term (name, ingredient, or category)."},
                        "source": {"type": "string",
                                   "description": "'local', 'web', or 'both'. Default 'local'."},
                    },
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_recipe",
                "description": "Get a recipe by id. Returns a concise summary by default. Set full=true only if the user explicitly asks for the complete ingredient list and every step.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recipe_id": {"type": "string",
                                      "description": "Recipe id from search_recipes."},
                        "full": {"type": "boolean",
                                 "description": "If true, return the full recipe with all ingredients and steps. Default false (summary only)."},
                    },
                    "required": ["recipe_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "add_recipe",
                "description": "Add a new recipe to the local kitchen store.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string",
                                 "description": "Recipe name."},
                        "category": {"type": "string",
                                     "description": "Category such as Breakfast, Lunch, Dinner, Snack, Drink, Treat."},
                        "ingredients": {"type": "array",
                                        "items": {"type": "string"},
                                        "description": "List of ingredients."},
                        "instructions": {"type": "array",
                                         "items": {"type": "string"},
                                         "description": "Numbered or listed cooking steps."},
                        "description": {"type": "string",
                                        "description": "Short description of the recipe."},
                    },
                    "required": ["name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_favorite",
                "description": "Mark or unmark a recipe as a favorite.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recipe_id": {"type": "string",
                                      "description": "Recipe id."},
                        "favorite": {"type": "boolean",
                                     "description": "True to favorite, false to remove."},
                    },
                    "required": ["recipe_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "scale_recipe",
                "description": "Scale a recipe's ingredient amounts by a factor (e.g., 2 for double, 0.5 for half).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recipe_id": {"type": "string",
                                      "description": "Recipe id from search_recipes."},
                        "factor": {"type": "number",
                                   "description": "Multiplier for ingredient amounts (e.g., 2, 0.5, 3)."},
                    },
                    "required": ["recipe_id", "factor"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_volume",
                "description": "Set JARVIS playback volume to a specific level between 0 and 1.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "level": {"type": "number",
                                  "description": "Volume level from 0.0 (silent) to 1.0 (maximum)."},
                    },
                    "required": ["level"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "volume_up",
                "description": "Increase JARVIS playback volume by 10%.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "volume_down",
                "description": "Decrease JARVIS playback volume by 10%.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mute_volume",
                "description": "Toggle JARVIS playback mute on or off.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "convert_units",
                "description": "Convert a kitchen quantity from one unit to another (volume or mass).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "quantity": {"type": "number",
                                     "description": "Numeric amount to convert."},
                        "from_unit": {"type": "string",
                                      "description": "Unit to convert from (e.g., cup, tbsp, oz, g)."},
                        "to_unit": {"type": "string",
                                    "description": "Unit to convert to (e.g., ml, gram, pint)."},
                    },
                    "required": ["quantity", "from_unit", "to_unit"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "unlock_jarvis",
                "description": "Unlock JARVIS out of Training Wheels Protocol using the configured password. Available even while locked.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "password": {"type": "string",
                                       "description": "The unlock password."},
                    },
                    "required": ["password"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "lock_jarvis",
                "description": "Re-enable Training Wheels Protocol and return to restricted mode.",
                "parameters": {"type": "object",
                               "properties": {},
                               "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "open_app",
                "description": "Open the requested application on the host machine.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string",
                                 "description": "Application name."},
                    },
                    "required": ["name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "open_website",
                "description": "Open the requested website in the host default browser.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string",
                                "description": "Website address."},
                    },
                    "required": ["url"],
                },
            },
        },
    ]

    if locked:
        return [d for d in all_definitions if d["function"]["name"] in SAFE_TOOLS]
    return all_definitions
