"""
saveDat Archives — Local Backend
FastAPI + SQLite + TMDB + Obsidian MD export
"""

import json
import os
import re
import sqlite3
import asyncio
import aiohttp
from urllib.request import Request, urlopen
from datetime import datetime
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── Config ──────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent.parent
CONFIG_PATH = BASE_DIR / "config.json"
DB_PATH = BASE_DIR / "backend" / "savedat.db"
VAULT_PATH = BASE_DIR / "vault"
FRONTEND_PATH = BASE_DIR / "frontend"

def load_config():
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {"tmdb_api_key": "", "vault_path": str(VAULT_PATH)}

config = load_config()
TMDB_KEY = config.get("tmdb_api_key", "")
TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w500"

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="saveDat Archives", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB ───────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS collections (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT NOT NULL,
            type    TEXT NOT NULL,
            color   TEXT DEFAULT "#000000",
            created TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS items (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
            tmdb_id       INTEGER,
            type          TEXT NOT NULL,
            title         TEXT NOT NULL,
            original_title TEXT,
            year          TEXT,
            poster        TEXT,
            backdrop      TEXT,
            rating        REAL,
            overview      TEXT,
            genres        TEXT,
            cast          TEXT,
            crew          TEXT,
            status        TEXT DEFAULT "plan_to_watch",
            user_rating   INTEGER,
            user_notes    TEXT,
            md_path       TEXT,
            tmdb_details  TEXT,
            added         TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id   INTEGER UNIQUE,
            name      TEXT NOT NULL,
            role      TEXT,
            md_path   TEXT
        );

        CREATE TABLE IF NOT EXISTS item_people (
            item_id   INTEGER REFERENCES items(id) ON DELETE CASCADE,
            person_id INTEGER REFERENCES people(id),
            role      TEXT,
            character TEXT,
            PRIMARY KEY(item_id, person_id, role)
        );

    """)
    # Existing installations predate the richer TMDB payload column.
    columns = {row["name"] for row in c.execute("PRAGMA table_info(items)")}
    if "tmdb_details" not in columns:
        c.execute("ALTER TABLE items ADD COLUMN tmdb_details TEXT")
    conn.commit()
    conn.close()

@app.on_event("startup")
def initialize_application():
    """Ensure a fresh database works whether Uvicorn imports or runs this module."""
    init_db()

# ── Models ───────────────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str
    type: str
    color: str = "#e8e8e8"

class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    color: Optional[str] = None

class ItemAdd(BaseModel):
    collection_id: int
    tmdb_id: int
    type: str

class ItemUpdate(BaseModel):
    status: Optional[str] = None
    user_rating: Optional[int] = None
    user_notes: Optional[str] = None

# ── TMDB Helpers ─────────────────────────────────────────────────────────────

async def tmdb_get(path: str, params: dict = {}):
    if not TMDB_KEY:
        raise HTTPException(400, "TMDB API key not configured. Edit config.json")
    params["api_key"] = TMDB_KEY
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{TMDB_BASE}{path}", params=params) as r:
            if r.status != 200:
                raise HTTPException(r.status, f"TMDB error: {await r.text()}")
            return await r.json()

def format_poster(path):
    if not path:
        return None
    return f"{TMDB_IMG}{path}"

def parse_year(date_str):
    if not date_str:
        return ""
    return date_str[:4]

# ── Obsidian MD Writer ───────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = re.sub(r'[^\w\s-]', '', text.lower())
    return re.sub(r'[-\s]+', '-', text).strip('-')

def media_folder(media_type: str) -> str:
    return "Movies" if media_type == "movie" else "TV Shows" if media_type == "tv" else "Anime"

def media_note_name(item: dict) -> str:
    title = item.get("title", "Unknown")
    year = item.get("year", "")
    return f"{slugify(title)}-{year}.md" if year else f"{slugify(title)}.md"

def media_wikilink(item: dict) -> str:
    """Link to the real vault-relative note path, never an unresolved title node."""
    target = f"{media_folder(item.get('type', 'movie'))}/{media_note_name(item)[:-3]}"
    return f"[[{target}|{item.get('title', 'Unknown')}]]"

def wikilink(name: str) -> str:
    return f"[[{name}]]"

def parse_json(value, default):
    if not value:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default

def yaml_string(value) -> str:
    return json.dumps(str(value or ""), ensure_ascii=False)

def read_vault_text(path: Path) -> str:
    """Read both new UTF-8 notes and legacy Windows-created CP1252 notes."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="cp1252")

def obsidian_tag(value: str) -> str:
    return slugify(value) or "untagged"

def download_poster(item: dict, vault: Path) -> str | None:
    """Store a local poster asset so the note remains useful offline in Obsidian."""
    poster_url = item.get("poster")
    if not poster_url:
        return None
    poster_dir = vault / "Assets" / "Posters"
    poster_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(poster_url.split("?", 1)[0]).suffix or ".jpg"
    name = f"{item.get('type', 'media')}-{slugify(item.get('title', 'unknown'))}-{item.get('year') or item.get('id')}{extension}"
    poster_path = poster_dir / name
    if not poster_path.exists():
        try:
            request = Request(poster_url, headers={"User-Agent": "saveDat Archives"})
            with urlopen(request, timeout=15) as response:
                poster_path.write_bytes(response.read())
        except Exception as error:
            print(f"Poster download error for {item.get('title')}: {error}")
            return None
    return poster_path.relative_to(vault).as_posix()

def write_person_md(name: str, role: str, vault: Path) -> Path:
    people_dir = vault / "People"
    people_dir.mkdir(parents=True, exist_ok=True)
    md_path = people_dir / f"{slugify(name)}.md"
    if not md_path.exists():
        md_path.write_text(f"""---
name: {name}
role: {role}
---

# {name}

**Role:** {role}

## Filmography

""", encoding="utf-8")
    return md_path

def write_item_md(item: dict, cast: list, crew: list, vault: Path) -> Path:
    media_type = item["type"]
    folder = media_folder(media_type)

    media_dir = vault / folder
    media_dir.mkdir(parents=True, exist_ok=True)

    title = item.get("title", "Unknown")
    year = item.get("year", "")
    filename = media_note_name(item)
    md_path = media_dir / filename

    # Build graph links.  Person notes are created below so every link resolves.
    directors = [p for p in crew if p.get("job") in ("Director", "Series Director", "Creator")]
    writers = [p for p in crew if p.get("job") in ("Writer", "Screenplay", "Story")]
    main_cast = cast[:15]

    genres_raw = parse_json(item.get("genres"), [])
    genres = [g["name"] if isinstance(g, dict) else g for g in genres_raw]
    details = parse_json(item.get("tmdb_details"), {})

    director_links = ", ".join(wikilink(d["name"]) for d in directors) or "Unknown"
    writer_links = ", ".join(wikilink(w["name"]) for w in writers) or "Unknown"
    cast_links = "\n".join(
        f"- {wikilink(c['name'])} as {c.get('character','')}" for c in main_cast
    )
    # Genres are deliberately tags, not wikilinks.  A genre note does not carry
    # useful content and wikilinking it creates unwanted root-vault placeholders.
    genre_labels = ", ".join(genres) or "—"
    crew_links = "\n".join(f"- {p.get('job', 'Crew')}: {wikilink(p['name'])}" for p in crew) or "_No credited crew data available._"
    poster_asset = download_poster(item, vault)
    poster = f"![[{poster_asset}]]" if poster_asset else (f"![{title} poster]({item['poster']})" if item.get("poster") else "")
    release_date = details.get("release_date") or details.get("first_air_date") or ""
    end_date = details.get("last_air_date") or ""
    countries = ", ".join(c.get("name", "") for c in details.get("production_countries", []) if c.get("name"))
    languages = ", ".join(l.get("english_name") or l.get("name", "") for l in details.get("spoken_languages", []) if l.get("english_name") or l.get("name"))
    companies = ", ".join(c.get("name", "") for c in details.get("production_companies", []) if c.get("name"))
    networks = ", ".join(n.get("name", "") for n in details.get("networks", []) if n.get("name"))
    fields = [
        ("TMDB", f"[{item.get('tmdb_id')}](https://www.themoviedb.org/{'tv' if media_type in ('tv', 'anime') else 'movie'}/{item.get('tmdb_id')})"),
        ("Release date", release_date), ("Last air date", end_date),
        ("Runtime", f"{details.get('runtime') or ((details.get('episode_run_time') or [None])[0]) or '—'} min"),
        ("Rating", f"⭐ {item.get('rating', 'N/A')} / 10"),
        ("Language", details.get("original_language", "")), ("Spoken languages", languages),
        ("Countries", countries), ("Production", companies), ("Network", networks),
        ("Seasons", details.get("number_of_seasons", "")), ("Episodes", details.get("number_of_episodes", "")),
        ("Status", item.get("status", "plan_to_watch").replace("_", " ").title()),
    ]
    detail_rows = "\n".join(f"| {label} | {value} |" for label, value in fields if value not in (None, ""))
    tag_lines = "\n".join(f"  - genre/{obsidian_tag(genre)}" for genre in genres)

    # Ensure person MDs exist
    for person in directors + writers + main_cast:
        write_person_md(person["name"], "Person", vault)

    content = f"""---
title: "{title}"
aliases: [{yaml_string(item.get('original_title'))}]
year: {yaml_string(year)}
type: {media_type}
tmdb_id: {item.get('tmdb_id', '')}
tmdb_url: "https://www.themoviedb.org/{'tv' if media_type in ('tv', 'anime') else 'movie'}/{item.get('tmdb_id', '')}"
rating: {item.get('rating', '') or 'null'}
watch_status: {item.get('status', 'plan_to_watch')}
tags:
  - media/{media_type}
{tag_lines}
---

# {title} ({year})

{poster}

> {item.get('overview', '')}

{f'> {details.get("tagline")}' if details.get('tagline') else ''}

## TMDB Details

| Field      | Value             |
|------------|-------------------|
| Type       | {media_type.title()} |
{detail_rows}
| Genres     | {genre_labels} |

## Director(s)

{director_links}

## Writer(s)

{writer_links}

## Cast

{cast_links}

## Crew

{crew_links}

## Notes

{item.get('user_notes') or '_No notes yet._'}

---
*Added to saveDat on {datetime.now().strftime('%B %d, %Y')}*
"""
    md_path.write_text(content, encoding="utf-8")

    # Append backlink to each person's file
    for person in directors + writers + main_cast:
        person_md = vault / "People" / f"{slugify(person['name'])}.md"
        if person_md.exists():
            existing = read_vault_text(person_md)
            link = f"- {media_wikilink(item)} ({year})"
            if link not in existing:
                person_md.write_text(existing + f"{link}\n", encoding="utf-8")

    return md_path

def save_people_and_links(conn, item_id: int, cast: list, crew: list):
    """Keep the relational database in sync with the Obsidian people graph."""
    for person in cast:
        existing = conn.execute("SELECT id FROM people WHERE tmdb_id=?", (person["tmdb_id"],)).fetchone()
        if not existing:
            person_id = conn.execute("INSERT INTO people (tmdb_id, name, role) VALUES (?,?,?)", (person["tmdb_id"], person["name"], "actor")).lastrowid
        else:
            person_id = existing["id"]
        conn.execute("INSERT OR IGNORE INTO item_people VALUES (?,?,?,?)", (item_id, person_id, "cast", person.get("character", "")))
    for person in crew:
        existing = conn.execute("SELECT id FROM people WHERE tmdb_id=?", (person["tmdb_id"],)).fetchone()
        if not existing:
            person_id = conn.execute("INSERT INTO people (tmdb_id, name, role) VALUES (?,?,?)", (person["tmdb_id"], person["name"], person.get("job", "crew"))).lastrowid
        else:
            person_id = existing["id"]
        conn.execute("INSERT OR IGNORE INTO item_people VALUES (?,?,?,?)", (item_id, person_id, person.get("job", "crew"), ""))

# ── Routes: Config ────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    cfg = load_config()
    return {
        "has_key": bool(cfg.get("tmdb_api_key")),
        "vault_path": cfg.get("vault_path") or str(VAULT_PATH),
        "custom_font_url": cfg.get("custom_font_url", ""),
        "custom_font_family": cfg.get("custom_font_family", ""),
    }

@app.post("/api/config")
def save_config(data: dict):
    # Settings updates are partial: the UI intentionally does not resend a masked
    # API key, so replacing the whole file would accidentally erase it.
    current_config = load_config()
    updated_config = dict(current_config)
    updated_config.setdefault("tmdb_api_key", "")
    updated_config["vault_path"] = current_config.get("vault_path") or str(VAULT_PATH)
    updated_config.update({key: value for key, value in data.items() if value is not None})
    with open(CONFIG_PATH, "w") as f:
        json.dump(updated_config, f, indent=2)
    global config, TMDB_KEY
    config = updated_config
    TMDB_KEY = updated_config["tmdb_api_key"]
    return {"ok": True}

# ── Routes: Search ────────────────────────────────────────────────────────────

@app.get("/api/search")
async def search(q: str = Query(...), type: str = "movie"):
    """Search TMDB for movies, tv, or anime."""
    if type == "anime":
        # Search TV with anime genre filter (genre 16 = Animation)
        data = await tmdb_get("/search/tv", {"query": q, "with_genres": "16"})
        results = []
        for r in data.get("results", [])[:15]:
            results.append({
                "tmdb_id": r["id"],
                "type": "anime",
                "title": r.get("name", r.get("original_name", "")),
                "year": parse_year(r.get("first_air_date", "")),
                "poster": format_poster(r.get("poster_path")),
                "rating": round(r.get("vote_average", 0), 1),
                "overview": r.get("overview", ""),
            })
    elif type == "tv":
        data = await tmdb_get("/search/tv", {"query": q})
        results = []
        for r in data.get("results", [])[:15]:
            results.append({
                "tmdb_id": r["id"],
                "type": "tv",
                "title": r.get("name", r.get("original_name", "")),
                "year": parse_year(r.get("first_air_date", "")),
                "poster": format_poster(r.get("poster_path")),
                "rating": round(r.get("vote_average", 0), 1),
                "overview": r.get("overview", ""),
            })
    else:
        data = await tmdb_get("/search/movie", {"query": q})
        results = []
        for r in data.get("results", [])[:15]:
            results.append({
                "tmdb_id": r["id"],
                "type": "movie",
                "title": r.get("title", r.get("original_title", "")),
                "year": parse_year(r.get("release_date", "")),
                "poster": format_poster(r.get("poster_path")),
                "rating": round(r.get("vote_average", 0), 1),
                "overview": r.get("overview", ""),
            })
    return {"results": results}

@app.get("/api/tmdb/{media_type}/{tmdb_id}")
async def get_details(media_type: str, tmdb_id: int):
    """Fetch full details + credits for an item."""
    endpoint = "/tv" if media_type in ("tv", "anime") else "/movie"
    data = await tmdb_get(f"{endpoint}/{tmdb_id}", {"append_to_response": "credits"})
    credits = data.get("credits", {})
    cast = [{"name": c["name"], "character": c.get("character",""), "tmdb_id": c["id"]} for c in credits.get("cast", [])[:15]]
    crew = [{"name": c["name"], "job": c.get("job",""), "tmdb_id": c["id"]} for c in credits.get("crew", []) if c.get("job") in ("Director","Writer","Screenplay","Story","Series Director","Creator")]
    for creator in data.get("created_by", []):
        creator_entry = {"name": creator["name"], "job": "Creator", "tmdb_id": creator["id"]}
        if creator_entry not in crew:
            crew.append(creator_entry)

    title = data.get("title") or data.get("name") or ""
    genres = [{"name": g["name"]} for g in data.get("genres", [])]
    year = parse_year(data.get("release_date") or data.get("first_air_date") or "")

    return {
        "tmdb_id": tmdb_id,
        "type": media_type,
        "title": title,
        "original_title": data.get("original_title") or data.get("original_name") or title,
        "year": year,
        "poster": format_poster(data.get("poster_path")),
        "backdrop": format_poster(data.get("backdrop_path")),
        "rating": round(data.get("vote_average", 0), 1),
        "overview": data.get("overview", ""),
        "genres": genres,
        "cast": cast,
        "crew": crew,
        "status_info": data.get("status", ""),
        "tagline": data.get("tagline", ""),
        # TMDB returns an empty list for some TV/anime episode runtimes.
        # Do not index it unless a value is actually present.
        "runtime": data.get("runtime") or ((data.get("episode_run_time") or [None])[0]),
        "seasons": data.get("number_of_seasons"),
        "episodes": data.get("number_of_episodes"),
        "tmdb_details": {key: value for key, value in data.items() if key != "credits"},
    }

# ── Routes: Collections ───────────────────────────────────────────────────────

@app.get("/api/collections")
def list_collections():
    conn = get_db()
    rows = conn.execute("SELECT *, (SELECT COUNT(*) FROM items WHERE collection_id=collections.id) as count FROM collections ORDER BY created DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/collections")
def create_collection(data: CollectionCreate):
    conn = get_db()
    cur = conn.execute("INSERT INTO collections (name, type, color) VALUES (?,?,?)", (data.name, data.type, data.color))
    conn.commit()
    row = conn.execute("SELECT * FROM collections WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/api/collections/{cid}")
def delete_collection(cid: int):
    conn = get_db()
    conn.execute("DELETE FROM collections WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.patch("/api/collections/{cid}")
def update_collection(cid: int, data: CollectionUpdate):
    updates = {key: value for key, value in data.dict().items() if value is not None}
    if "name" in updates and not updates["name"].strip():
        raise HTTPException(422, "Collection name cannot be empty")
    conn = get_db()
    if not conn.execute("SELECT 1 FROM collections WHERE id=?", (cid,)).fetchone():
        conn.close()
        raise HTTPException(404, "Collection not found")
    if updates:
        assignments = ", ".join(f"{column}=?" for column in updates)
        conn.execute(f"UPDATE collections SET {assignments} WHERE id=?", (*updates.values(), cid))
        conn.commit()
    row = conn.execute("SELECT * FROM collections WHERE id=?", (cid,)).fetchone()
    conn.close()
    return dict(row)

# ── Routes: Items ─────────────────────────────────────────────────────────────

@app.get("/api/collections/{cid}/items")
def list_items(cid: int):
    conn = get_db()
    rows = conn.execute("SELECT * FROM items WHERE collection_id=? ORDER BY added DESC", (cid,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/items")
def list_library_items(type: str = "all"):
    """Return the saved library across collections, optionally by media type."""
    if type not in ("all", "movies", "tv", "anime"):
        raise HTTPException(422, "Unknown media type")
    conn = get_db()
    query = "SELECT i.*, c.name AS collection_name, c.color AS collection_color FROM items i JOIN collections c ON c.id=i.collection_id"
    params = []
    if type != "all":
        query += " WHERE i.type=?"
        params.append("movie" if type == "movies" else type)
    query += " ORDER BY i.added DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/items")
async def add_item(data: ItemAdd):
    # Fetch full details from TMDB
    details = await get_details(data.type, data.tmdb_id)
    cast = details.pop("cast", [])
    crew = details.pop("crew", [])

    conn = get_db()
    # Check if already in collection
    existing = conn.execute(
        "SELECT id FROM items WHERE collection_id=? AND tmdb_id=?",
        (data.collection_id, data.tmdb_id)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(409, "Already in collection")

    genres_json = json.dumps(details.get("genres", []))
    cast_json = json.dumps(cast)
    crew_json = json.dumps(crew)

    cur = conn.execute("""
        INSERT INTO items (collection_id, tmdb_id, type, title, original_title, year,
            poster, backdrop, rating, overview, genres, cast, crew, tmdb_details)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        data.collection_id, data.tmdb_id, data.type,
        details["title"], details["original_title"], details["year"],
        details["poster"], details["backdrop"], details["rating"],
        details["overview"], genres_json, cast_json, crew_json,
        json.dumps(details.get("tmdb_details", {}), ensure_ascii=False)
    ))
    item_id = cur.lastrowid

    # Write Obsidian MD
    vault = Path(config.get("vault_path") or VAULT_PATH)
    item_row = dict(conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())
    try:
        md_path = write_item_md(item_row, cast, crew, vault)
        conn.execute("UPDATE items SET md_path=? WHERE id=?", (str(md_path), item_id))
        save_people_and_links(conn, item_id, cast, crew)
    except Exception as e:
        print(f"MD write error: {e}")

    conn.commit()
    result = dict(conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())
    conn.close()
    return result

@app.patch("/api/items/{item_id}")
def update_item(item_id: int, data: ItemUpdate):
    conn = get_db()
    updates = {k: v for k, v in data.dict().items() if v is not None}
    if not updates:
        conn.close()
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in updates)
    conn.execute(f"UPDATE items SET {sets} WHERE id=?", (*updates.values(), item_id))
    conn.commit()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    conn = get_db()
    item = conn.execute("SELECT md_path FROM items WHERE id=?", (item_id,)).fetchone()
    if item and item["md_path"]:
        try:
            Path(item["md_path"]).unlink(missing_ok=True)
        except:
            pass
    conn.execute("DELETE FROM items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Routes: People ────────────────────────────────────────────────────────────

@app.get("/api/people/{person_id}/works")
def person_works(person_id: int):
    conn = get_db()
    rows = conn.execute("""
        SELECT i.*, ip.role, ip.character FROM items i
        JOIN item_people ip ON i.id = ip.item_id
        JOIN people p ON ip.person_id = p.id
        WHERE p.id = ?
    """, (person_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ── Serve Frontend ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(FRONTEND_PATH), html=True), name="static")

@app.get("/")
def root():
    return FileResponse(str(FRONTEND_PATH / "index.html"))

@app.get("/nighty-font")
def nighty_font():
    """Project title font; kept separate from the user-selectable site font."""
    return FileResponse(str(BASE_DIR / "Nightydemo.otf"), media_type="font/otf")

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("\n✦ saveDat Archives — Local Server")
    print("  → http://localhost:8000\n")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
