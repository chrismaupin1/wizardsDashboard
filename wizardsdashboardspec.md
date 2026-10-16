# Washington Wizards Dashboard — Build Spec

A project spec to hand to Claude Code. Build a static-JSON dashboard: Python pulls
Wizards data from the NBA stats API and writes JSON; a vanilla JS/HTML/CSS front end
renders it.

---

## Goal

Two views on one page:

1. **Team season overview** — record, conference rank, points for/against, streak, last 5 games.
2. **Player stats table** — full roster with per-game stats and shooting splits, sortable and filterable.

No framework, no build step, no server required to view.

---

## Architecture

Python script → `data/*.json` → front end `fetch()`es the JSON on page load.

Chosen over a Flask API because it needs no running server, hosts free on GitHub Pages,
and refreshes with one command. The JSON shape is designed so that swapping to Flask
later means changing a URL, nothing else.

---

## File structure

```
wizards-dashboard/
├── fetch/
│   ├── fetch_data.py       # main script, writes data/*.json
│   └── config.py           # TEAM_ID, SEASON, paths
├── data/
│   ├── team.json
│   ├── players.json
│   ├── games.json
│   └── meta.json
├── web/
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
├── requirements.txt
└── README.md
```

---

## Constants

```python
TEAM_ID = 1610612764        # Washington Wizards (verified)
SEASON  = "2025-26"         # most recently completed season as of Aug 2026
```

Keep both in `fetch/config.py`. Nothing else should hardcode them.

---

## Python layer

Dependency: `nba_api` (plus `pandas`, which it pulls in).

### Endpoints to use

| Endpoint | Provides | Writes to |
|---|---|---|
| `leaguestandingsv3` | W-L, conference rank, home/road splits, current streak, last-10 | `team.json` |
| `teamyearbyyearstats` | season PPG / opponent PPG for context | `team.json` |
| `commonteamroster` | name, number, position, height, weight, experience | `players.json` |
| `leaguedashplayerstats` | PPG, RPG, APG, FG%, 3P%, FT%, MIN, GP | `players.json` |
| `teamgamelog` | game-by-game W/L, score, opponent, date | `games.json` |

### Important: verify keyword argument names before writing calls

`nba_api` parameter names are inconsistent across endpoints (`team_id` vs
`team_id_nullable`, `season_type_all_star` vs `season_type_nullable`, etc.). Do not
guess them. For each endpoint, inspect the actual signature first:

```python
import inspect
from nba_api.stats.endpoints import leaguedashplayerstats
print(inspect.signature(leaguedashplayerstats.LeagueDashPlayerStats.__init__))
```

Then write the call. Getting this wrong produces confusing empty results rather than
a clean error.

Known-good starting points to confirm:

- `LeagueDashPlayerStats(season=SEASON, team_id_nullable=TEAM_ID, per_mode_detailed="PerGame")`
- `CommonTeamRoster(team_id=TEAM_ID, season=SEASON)`
- `TeamGameLog(team_id=TEAM_ID, season=SEASON)`

### Script requirements

- **`time.sleep(0.6)` between every API call.** stats.nba.com throttles hard and starts
  returning timeouts without spacing. Set `timeout=30` on each endpoint call too.
- **Request per-game values from the API** (`per_mode_detailed="PerGame"`), don't compute
  them from totals. Round to one decimal in Python so the front end does zero math.
- **Join roster to stats on `PLAYER_ID`, left-joined from the roster**, so two-way and
  inactive players still appear with null stats instead of silently disappearing.
- **Atomic writes** — write each file to `<name>.json.tmp`, then `os.replace()` it into
  place. Stops the page from reading a half-written file if it's refreshed mid-run.
- **Per-endpoint error isolation** — wrap each fetch in try/except, log which one failed,
  still write the files that succeeded, and `sys.exit(1)` at the end if any failed.
- **`meta.json`** holds `{"last_updated": <ISO 8601 UTC>, "season": SEASON}`. The front
  end displays this so stale data is obvious.

### Note on where this runs

stats.nba.com blocks most cloud/datacenter IP ranges. Run `fetch_data.py` from a normal
home/office connection. If it fails with proxy or connection errors from a hosted
environment, that's the cause, not the code.

---

## JSON contracts

Design the front end against these shapes.

`team.json`
```json
{
  "team_name": "Washington Wizards",
  "wins": 0, "losses": 0, "win_pct": 0.0,
  "conference": "East", "conference_rank": 0,
  "points_per_game": 0.0, "opp_points_per_game": 0.0,
  "streak": "W2", "last_10": "4-6",
  "home_record": "12-29", "road_record": "6-35"
}
```

`players.json` — array of objects
```json
[{
  "player_id": 0, "name": "", "number": "", "position": "",
  "height": "", "weight": "", "experience": "",
  "gp": 0, "min": 0.0, "pts": 0.0, "reb": 0.0, "ast": 0.0,
  "stl": 0.0, "blk": 0.0, "fg_pct": 0.0, "fg3_pct": 0.0, "ft_pct": 0.0
}]
```

`games.json` — array, most recent first
```json
[{
  "date": "2026-04-12", "opponent": "MIA", "home": true,
  "result": "W", "team_score": 112, "opp_score": 108
}]
```

---

## Front end

Vanilla JS in one `app.js`. No framework, no bundler.

**Load** — `Promise.all` on the four fetches. Show a loading state; on any failure show a
single error banner rather than a blank page.

**Team overview** — a responsive grid of stat cards (record, conference seed, PPG,
opponent PPG, streak, last-10), then a compact last-5-games list with colored W/L pills.

**Player table** — all rows, no pagination (a 15-man roster doesn't need it).
- Click a column header to sort: first click descending, second ascending.
- Sort state in a single object; re-render the table from a sorted copy of the array.
- A text input filters by player name as you type.
- Null stats render as `—`, and null values always sort to the bottom regardless of direction.

**Styling** — Wizards navy `#002B5C` and red `#E31837` on a light neutral background.
Put the palette in CSS custom properties on `:root` so it's one place to change. CSS grid
for the card row. Breakpoint at 768px: cards go single-column, table gets a horizontally
scrollable wrapper (`overflow-x: auto`) rather than squashing.

Display `meta.last_updated` in the footer, formatted readably.

### Gotcha to handle in the README

Opening `index.html` directly as `file://` makes `fetch()` fail on CORS. The README must
say: run `python -m http.server 8000` from the project root, then open
`http://localhost:8000/web/`.

---

## Build order

1. `config.py` and `fetch_data.py`; run it and inspect the JSON output by hand
2. `index.html` and the CSS shell with the card grid
3. Team overview rendering
4. Player table with sort and filter
5. Loading/error states and the responsive pass
6. `README.md` with setup, run, and refresh instructions

---

## Acceptance criteria

- `python fetch/fetch_data.py` writes four valid JSON files matching the contracts above
- Re-running it overwrites cleanly, with no partial files if interrupted
- The page renders fully from those files with no console errors
- Every player-table column sorts both directions
- The name filter narrows rows live
- The layout is usable at 375px wide
- The footer shows when the data was last pulled

---

## Explicitly out of scope for v1

- Shot charts (`shotchartdetail` returns thousands of rows per player and needs a
  court-drawing layer — good second feature, bad first one)
- Multi-season comparison (`teamyearbyyearstats` has data back to 1961, so a season
  picker is a natural v2)
- Live/in-progress game updates
