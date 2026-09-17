# saveDat Archives

> Local media tracker for Movies, TV Shows, and Anime — with Obsidian vault integration.

**Stack:** HTML/CSS/JS frontend · FastAPI · SQLite · TMDB API · Obsidian Markdown export

---

## Quick Start

### First time

```bash
# Mac/Linux
chmod +x scripts/setup.sh && ./scripts/setup.sh

# Windows
scripts\setup.bat
```

The setup script will:
1. Install Python dependencies
2. Ask for your TMDB API key
3. Ask for your Obsidian vault path
4. Start the server

### After setup

```bash
./start.sh        # Mac/Linux
start.bat         # Windows
```

Then open **http://localhost:8000** in your browser.

---

## Getting a TMDB API Key

1. Sign up free at [themoviedb.org](https://www.themoviedb.org)
2. Go to **Settings → API**
3. Copy your v3 API key
4. Paste it when prompted (or in Settings inside the app)

---

## Project Structure

```
savedat/
├── frontend/
│   ├── index.html          ← Single-page app
│   ├── css/main.css        ← Neubrutalism design system + 7 themes
│   └── js/app.js           ← All UI logic
│
├── backend/
│   ├── server.py           ← FastAPI server + SQLite + TMDB + MD writer
│   └── savedat.db          ← Auto-created SQLite database
│
├── vault/                  ← Obsidian markdown files (auto-generated)
│   ├── Movies/
│   │   └── inception-2010.md
│   ├── TV Shows/
│   │   └── breaking-bad-2008.md
│   ├── Anime/
│   │   └── attack-on-titan-2013.md
│   └── People/
│       └── christopher-nolan.md
│
├── config.json             ← TMDB key + vault path
├── start.sh / start.bat    ← Daily start scripts
└── scripts/
    ├── setup.sh
    └── setup.bat
```

---

## Features

### Collections
- Create named collections per type (Movies / TV / Anime)
- Color-code each collection
- Delete collections and all their items

### Items
- Search TMDB by title
- One-click add to collection
- Status tracking: Watching / Completed / Plan to Watch / Dropped / On Hold
- Personal 1–10 star rating
- Personal notes (saved to DB + MD file)
- Remove from collection

### Obsidian Integration
Every item you add auto-generates:

**`vault/Movies/inception-2010.md`**
```markdown
---
title: "Inception"
year: 2010
type: movie
tmdb_id: 27205
rating: 8.4
status: completed
tags: [Action, Science Fiction, Adventure]
---

# Inception (2010)

> A thief who steals corporate secrets...

## Director(s)
[[Christopher Nolan]]

## Writer(s)
[[Christopher Nolan]]

## Cast
- [[Leonardo DiCaprio]] as Dom Cobb
- [[Joseph Gordon-Levitt]] as Arthur
...
```

**`vault/People/christopher-nolan.md`** — auto-updated with backlinks each time you add something he directed.

Point Obsidian at your `vault/` folder to get the full graph view of directors, cast, genres.

### Themes
7 dark neubrutalism themes (Crimson, Amber, Emerald, Teal, Steel Blue, Rose, Vermillion) — switch from the dots in the top bar.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collections` | List all collections |
| POST | `/api/collections` | Create collection |
| DELETE | `/api/collections/{id}` | Delete collection |
| GET | `/api/collections/{id}/items` | List items |
| POST | `/api/items` | Add item (fetches TMDB + writes MD) |
| PATCH | `/api/items/{id}` | Update status/rating/notes |
| DELETE | `/api/items/{id}` | Remove item |
| GET | `/api/search?q=&type=` | Search TMDB |
| GET/POST | `/api/config` | Get/set config |

---

## Adding More Later

- **Books/Games**: swap in Open Library / RAWG, add new type values, extend the DB schema
- **Watch history**: add a `history` table with timestamps
- **Stats page**: recharts-style charts per collection
- **Export**: dump `items` table to CSV with one script
