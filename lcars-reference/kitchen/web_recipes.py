import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request


# ============================================================
# J.A.R.V.I.S KITCHEN — WEB RECIPE ENGINE v4.2
# ============================================================

API_URL = "https://www.themealdb.com/api/json/v1/1/"
USER_AGENT = "J.A.R.V.I.S Kitchen/4.2"

TIMEOUT = 15
MAX_RESULTS = 20
DETAIL_LIMIT = 12


# ============================================================
# ALIASES
# ============================================================

ALIASES = {
    "milk shake": "milkshake",
    "milk shakes": "milkshake",
    "milkshakes": "milkshake",
    "smoothies": "smoothie",
    "choc": "chocolate",
    "pancakes": "pancake",
    "waffles": "waffle",
    "cookies": "cookie",
    "brownies": "brownie",
    "cakes": "cake",
    "pies": "pie",
    "burgers": "burger",
    "hamburgers": "burger",
    "sandwiches": "sandwich",
    "pastas": "pasta",
    "soups": "soup",
    "salads": "salad",
}


# ============================================================
# FOOD TYPES
# ============================================================

FOOD_TYPES = {

    "milkshake": {
        "required": [
            "milkshake",
            "milk shake",
            "shake"
        ],
        "positive": [
            "milkshake",
            "milk shake",
            "shake"
        ],
        "negative_name": [
            "empanada",
            "pie",
            "cake",
            "cookie",
            "brownie",
            "pasta",
            "soup",
            "salad",
            "sandwich"
        ]
    },

    "smoothie": {
        "required": ["smoothie"],
        "positive": ["smoothie"],
        "negative_name": [
            "empanada",
            "pie",
            "cake",
            "pasta",
            "soup",
            "sandwich"
        ]
    },

    "cake": {
        "required": ["cake"],
        "positive": ["cake"],
        "negative_name": [
            "empanada",
            "pie",
            "pasta",
            "soup",
            "salad"
        ]
    },

    "pie": {
        "required": ["pie"],
        "positive": ["pie"],
        "negative_name": [
            "empanada",
            "cake",
            "pasta",
            "soup",
            "salad"
        ]
    },

    "pasta": {
        "required": [
            "pasta",
            "spaghetti",
            "macaroni",
            "linguine",
            "penne",
            "noodle"
        ],
        "positive": [
            "pasta",
            "spaghetti",
            "macaroni",
            "linguine",
            "penne",
            "noodle"
        ],
        "negative_name": [
            "milkshake",
            "smoothie",
            "cake",
            "pie"
        ]
    },

    "soup": {
        "required": [
            "soup",
            "stew",
            "broth"
        ],
        "positive": [
            "soup",
            "stew",
            "broth"
        ],
        "negative_name": [
            "milkshake",
            "smoothie",
            "cake",
            "pie"
        ]
    },

    "salad": {
        "required": ["salad"],
        "positive": ["salad"],
        "negative_name": [
            "milkshake",
            "smoothie",
            "cake",
            "pie"
        ]
    },

    "burger": {
        "required": [
            "burger",
            "hamburger"
        ],
        "positive": [
            "burger",
            "hamburger"
        ],
        "negative_name": [
            "milkshake",
            "smoothie",
            "cake",
            "pie"
        ]
    },

    "sandwich": {
        "required": ["sandwich"],
        "positive": ["sandwich"],
        "negative_name": [
            "milkshake",
            "smoothie",
            "cake",
            "pie"
        ]
    },
}


# ============================================================
# STOP WORDS
# ============================================================

STOP_WORDS = {
    "easy",
    "best",
    "good",
    "simple",
    "quick",
    "recipe",
    "recipes",
    "make",
    "making",
    "how",
    "to",
    "a",
    "an",
    "the",
    "for",
    "with",
    "and",
    "of",
    "please",
    "find",
    "me",
    "some",
}


# ============================================================
# NETWORK
# ============================================================

def api_request(endpoint, params=None, retries=3):

    if params:
        safe_params = {}

        for key, value in params.items():

            if value is None:
                continue

            safe_params[str(key)] = str(value)

        query = urllib.parse.urlencode(safe_params)

        url = API_URL + endpoint + "?" + query

    else:
        url = API_URL + endpoint

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }
    )

    last_error = None

    for attempt in range(retries):

        try:

            with urllib.request.urlopen(
                request,
                timeout=TIMEOUT
            ) as response:

                raw = response.read()

                if not raw:
                    return {}

                text = raw.decode("utf-8", errors="replace")

                return json.loads(text)

        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            TimeoutError,
            ConnectionError
        ) as error:

            last_error = error

            print(
                f"Recipe API attempt {attempt + 1}/{retries} failed:",
                error
            )

            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))

        except json.JSONDecodeError as error:

            print("Recipe API returned invalid JSON:", error)

            return {}

        except Exception as error:

            last_error = error

            print("Recipe API error:", error)

            if attempt < retries - 1:
                time.sleep(0.5)

    print("Recipe network failed:", last_error)

    return None


# ============================================================
# API HELPERS
# ============================================================

def search_by_name(query):

    query = str(query or "").strip()

    if not query:
        return []

    data = api_request("search.php", {"s": query})

    if data is None:
        return None

    meals = data.get("meals")

    if not isinstance(meals, list):
        return []

    return meals


def filter_by_ingredient(ingredient):

    ingredient = str(ingredient or "").strip()

    if not ingredient:
        return []

    data = api_request("filter.php", {"i": ingredient})

    if data is None:
        return None

    meals = data.get("meals")

    if not isinstance(meals, list):
        return []

    return meals


def filter_by_category(category):

    category = str(category or "").strip()

    if not category:
        return []

    data = api_request("filter.php", {"c": category})

    if data is None:
        return None

    meals = data.get("meals")

    if not isinstance(meals, list):
        return []

    return meals


def get_meal_details(meal_id):

    if meal_id is None:
        return None

    meal_id = str(meal_id).strip()

    if not meal_id:
        return None

    data = api_request("lookup.php", {"i": meal_id})

    if not data:
        return None

    meals = data.get("meals")

    if not isinstance(meals, list):
        return None

    if not meals:
        return None

    return meals[0]


# ============================================================
# TEXT NORMALIZATION
# ============================================================

def normalize(text):

    if text is None:
        return ""

    text = str(text).lower()

    text = text.replace("&", " and ")
    text = text.replace("’", "")
    text = text.replace("'", "")
    text = text.replace("-", " ")
    text = text.replace("/", " ")

    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()


def words(text):

    value = normalize(text)

    if not value:
        return []

    return value.split()


# ============================================================
# QUERY CANONICALIZATION
# ============================================================

def canonicalize_query(query):

    value = normalize(query)

    if not value:
        return ""

    # Multi-word aliases FIRST.
    value = re.sub(r"\bmilk\s+shakes?\b", "milkshake", value)

    # Normalize plural milkshake.
    value = re.sub(r"\bmilkshakes\b", "milkshake", value)

    tokens = value.split()

    converted = []

    for token in tokens:
        replacement = ALIASES.get(token, token)
        converted.append(str(replacement))

    return " ".join(converted)


# ============================================================
# FOOD TYPE DETECTION
# ============================================================

def detect_food_type(query):

    query = canonicalize_query(query)

    if not query:
        return None

    priority = [
        "milkshake",
        "smoothie",
        "sandwich",
        "burger",
        "pasta",
        "soup",
        "salad",
        "cake",
        "pie",
    ]

    query_words = set(words(query))

    for food_type in priority:

        info = FOOD_TYPES.get(food_type)

        if not info:
            continue

        for required in info["required"]:

            required_normalized = normalize(required)

            if not required_normalized:
                continue

            if (
                required_normalized in query
                or required_normalized in query_words
            ):
                return food_type

    return None


# ============================================================
# MODIFIERS
# ============================================================

def extract_modifiers(query):

    normalized = canonicalize_query(query)

    food_type = detect_food_type(normalized)

    result = []

    for word in words(normalized):

        if word in STOP_WORDS:
            continue

        if food_type and word == food_type:
            continue

        # Remove individual milkshake words.
        if word in {"milk", "shake", "milkshake"}:
            continue

        if len(word) < 3:
            continue

        result.append(word)

    return result


# ============================================================
# MEAL TEXT
# ============================================================

def meal_search_text(meal):

    if not isinstance(meal, dict):
        return ""

    pieces = []

    def add(value):

        if value is None:
            return

        value = str(value).strip()

        if value:
            pieces.append(value)

    add(meal.get("strMeal"))
    add(meal.get("strCategory"))
    add(meal.get("strArea"))

    for number in range(1, 21):
        add(meal.get(f"strIngredient{number}"))

    add(meal.get("strInstructions"))

    return normalize(
        " ".join(
            str(piece)
            for piece in pieces
            if piece is not None
        )
    )


# ============================================================
# NAME
# ============================================================

def meal_name(meal):

    if not isinstance(meal, dict):
        return ""

    return normalize(meal.get("strMeal", ""))


# ============================================================
# STRICT FILTER (SMART VERSION)
# ============================================================

def passes_strict_filter(meal, query):

    if not isinstance(meal, dict):
        return False

    query = canonicalize_query(query)

    food_type = detect_food_type(query)

    # If no specific food type was requested, accept the recipe.
    if not food_type:
        return True

    info = FOOD_TYPES[food_type]

    name = meal_name(meal)
    text = meal_search_text(meal)

    # Required/positive terms must appear anywhere in the recipe,
    # not only in the name. This fixes searches like "chocolate milkshake"
    # where the API may return recipes without "milkshake" in the title.
    required_match = any(
        normalize(term) in name
        or normalize(term) in text
        for term in info["required"]
        if normalize(term)
    )

    if not required_match:
        return False

    # Reject recipes whose name contains a conflicting food type.
    for bad in info["negative_name"]:
        bad = normalize(bad)
        if bad and bad in name:
            return False

    return True


# ============================================================
# SCORING
# ============================================================

def score_meal(meal, query):

    if not isinstance(meal, dict):
        return -999999

    query = canonicalize_query(query)

    modifiers = extract_modifiers(query)

    food_type = detect_food_type(query)

    name = meal_name(meal)
    text = meal_search_text(meal)

    score = 0

    # Exact name
    if name == query:
        score += 10000

    if query and query in name:
        score += 5000

    # Food type
    if food_type:

        info = FOOD_TYPES[food_type]

        if any(
            normalize(term) in name
            for term in info["positive"]
            if normalize(term)
        ):
            score += 5000

        elif any(
            normalize(term) in text
            for term in info["positive"]
            if normalize(term)
        ):
            score += 800

        else:
            # Penalize if the food type is missing entirely.
            score -= 5000

    # Modifiers (chocolate, vanilla, etc.)
    for modifier in modifiers:

        modifier = normalize(modifier)

        if not modifier:
            continue

        if modifier in name.split():
            score += 3000

        elif modifier in name:
            score += 2000

        else:

            ingredient_match = False

            for number in range(1, 21):

                ingredient = normalize(
                    meal.get(f"strIngredient{number}", "")
                )

                if modifier in ingredient:
                    ingredient_match = True
                    break

            if ingredient_match:
                score += 1800

            elif modifier in text:
                score += 500

            else:
                score -= 500

    # Special ingredients bonus
    for modifier in (
        "chocolate",
        "vanilla",
        "strawberry",
        "banana",
        "caramel",
        "coffee",
        "peanut",
        "coconut"
    ):

        if modifier not in modifiers:
            continue

        if modifier in name:
            score += 2500

        elif modifier in text:
            score += 1000

        else:
            score -= 500

    return score


# ============================================================
# COLLECTION
# ============================================================

def add_meals(storage, meals):

    if not isinstance(meals, list):
        return

    for meal in meals:

        if not isinstance(meal, dict):
            continue

        meal_id = meal.get("idMeal")

        if meal_id is None:
            continue

        meal_id = str(meal_id).strip()

        if not meal_id:
            continue

        storage[meal_id] = meal


# ============================================================
# CANDIDATE SEARCH
# ============================================================

def collect_candidates(query):

    normalized = canonicalize_query(query)

    all_meals = {}
    network_failed = False

    direct = search_by_name(normalized)

    if direct is None:
        network_failed = True
    else:
        add_meals(all_meals, direct)

    food_type = detect_food_type(normalized)
    modifiers = extract_modifiers(normalized)

    for modifier in modifiers:

        if not modifier:
            continue

        results = search_by_name(modifier)

        if results is None:
            network_failed = True
            continue

        add_meals(all_meals, results)

    for modifier in modifiers:

        if not modifier:
            continue

        results = filter_by_ingredient(modifier)

        if results is None:
            network_failed = True
            continue

        add_meals(all_meals, results)

    if food_type:

        results = search_by_name(food_type)

        if results is None:
            network_failed = True
        else:
            add_meals(all_meals, results)

    return all_meals, network_failed


# ============================================================
# SMART SEARCH
# ============================================================

def search_recipes(query):

    query = str(query or "").strip()

    if not query:
        return []

    normalized = canonicalize_query(query)

    food_type = detect_food_type(normalized)
    modifiers = extract_modifiers(normalized)

    print()
    print("=" * 44)
    print("J.A.R.V.I.S SMART RECIPE SEARCH")
    print("QUERY:", query)
    print("NORMALIZED:", normalized)
    print("FOOD TYPE:", food_type)
    print("MODIFIERS:", modifiers)
    print("=" * 44)

    all_meals, network_failed = collect_candidates(normalized)

    if not all_meals:

        if network_failed:

            print(
                "Recipe search failed because "
                "the recipe service could not be reached."
            )

            return None

        print("No recipes found.")

        return []

    candidates = []

    for meal in all_meals.values():

        try:

            if passes_strict_filter(meal, normalized):
                candidates.append(meal)

        except Exception as error:

            print("Recipe filter error:", error)

    if not candidates:

        print("No recipes matched the requested food type.")

        return []

    candidates.sort(
        key=lambda meal: score_meal(meal, normalized),
        reverse=True
    )

    candidates = candidates[:MAX_RESULTS]

    results = []

    for meal in candidates[:DETAIL_LIMIT]:

        meal_id = meal.get("idMeal")

        detailed = None

        if meal_id:

            try:
                detailed = get_meal_details(meal_id)
            except Exception as error:
                print("Recipe detail error:", error)

        source_meal = detailed if detailed else meal

        try:

            converted = convert_meal(source_meal)

            if converted:
                results.append(converted)

        except Exception as error:
            print("Recipe conversion error:", error)

    print("MATCHES:", len(results))

    return results


# ============================================================
# CONVERT API DATA
# ============================================================

def convert_meal(meal):

    if not isinstance(meal, dict):
        return None

    ingredients = []

    for number in range(1, 21):

        ingredient = meal.get(f"strIngredient{number}")
        measure = meal.get(f"strMeasure{number}")

        if ingredient is None:
            continue

        ingredient = str(ingredient).strip()

        if not ingredient:
            continue

        measure = str(measure or "").strip()

        if measure:
            ingredient += " — " + measure

        ingredients.append(ingredient)

    instructions_text = str(
        meal.get("strInstructions") or ""
    ).strip()

    instructions = split_instructions(instructions_text)

    description = instructions_text

    if len(description) > 260:
        description = description[:260] + "..."

    return {
        "name": str(meal.get("strMeal") or "Unknown Recipe"),
        "category": str(meal.get("strCategory") or "Recipe"),
        "area": str(meal.get("strArea") or ""),
        "description": description,
        "ingredients": ingredients,
        "instructions": instructions,
        "image": str(meal.get("strMealThumb") or ""),
        "source": str(meal.get("strSource") or ""),
        "youtube": str(meal.get("strYoutube") or ""),
        "id": str(meal.get("idMeal") or ""),
        "web": True
    }


# ============================================================
# INSTRUCTION PARSER
# ============================================================

def split_instructions(text):

    if not text:
        return []

    text = str(text)

    text = text.replace("\r", "").strip()

    if not text:
        return []

    # Numbered steps
    numbered = re.split(r"\n\s*(?:\d+[\.\)]|-)\s*", text)

    if len(numbered) > 1:

        result = []

        for step in numbered:

            value = clean_step(step)

            if value:
                result.append(value)

        if result:
            return result

    # Lines
    lines = text.split("\n")

    result = []

    for line in lines:

        value = clean_step(line)

        if value:
            result.append(value)

    if len(result) > 1:
        return result

    # Sentence fallback
    sentences = re.split(r"(?<=[.!?])\s+", text)

    result = []

    for sentence in sentences:

        value = clean_step(sentence)

        if value:
            result.append(value)

    return result or [text]


def clean_step(text):

    if text is None:
        return ""

    text = str(text).strip()

    text = re.sub(r"^[\-\*\d\.\)\s]+", "", text)

    return text.strip()
