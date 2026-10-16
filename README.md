# Washington Wizards Dashboard

A static dashboard for the Washington Wizards: a Python script pulls from the NBA
stats API and writes JSON, and a vanilla JS/HTML/CSS front end renders it. No
framework, no build step, no server needed beyond a plain static file server.

Two views on one page:

- **Team season overview** — record, conference seed, points for/against, current
  streak, last 10, and the last five games.
- **Player stats table** — the full roster with per-game stats and shooting
  splits, sortable by every column and filterable by name.

---

## Setup

Requires Python 3.9+.

```bash
cd wizards-dashboard
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

`nba_api` pulls in `pandas`, so the first install takes a minute.

---

## Pull the data

```bash
./.venv/bin/python fetch/fetch_data.py
```

This writes four files into `data/`:

| File | Contents |
|---|---|
| `team.json` | record, conference seed, PPG / opponent PPG, streak, home & road splits |
| `players.json` | roster joined to per-game stats |
| `games.json` | every regular-season game, most recent first |
| `meta.json` | when the data was pulled, and for which season |

Expected output ends with `Done. All endpoints succeeded.` and exits 0. If any
endpoint fails, the script logs which one, still writes the files that
succeeded, and exits 1.

Re-run it any time to refresh. Each file is written to `<name>.json.tmp` and
then moved into place, so an interrupted run never leaves a half-written file
for the page to read.

---

## View the dashboard

```bash
./.venv/bin/python -m http.server 8000
```

Then open **<http://localhost:8000/web/>**.

> **Do not open `web/index.html` by double-clicking it.** Over a `file://` URL
> the browser blocks `fetch()` as a cross-origin request, and the page shows its
> error banner instead of the dashboard. It has to be served over HTTP.

Serve from the **project root**, not from `web/` — the page loads its JSON from
`../data/`.

To stop the server: `Ctrl-C`, or `lsof -ti:8000 | xargs kill` if it's running in
the background.

---

## Project layout

```
wizards-dashboard/
├── fetch/
│   ├── config.py           # TEAM_ID, SEASON, paths, request pacing
│   └── fetch_data.py       # writes data/*.json
├── data/                   # generated - not meant to be edited by hand
├── web/
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
├── requirements.txt
└── README.md
```

### Changing team or season

`fetch/config.py` holds `TEAM_ID` and `SEASON`, and nothing else hardcodes
them. Change them there and re-run the fetch:

```python
TEAM_ID = 1610612764        # Washington Wizards
SEASON  = "2025-26"
```

The front end reads the season out of `meta.json`, so it follows along. The
`W` monogram and the navy/red palette in `web/css/styles.css` are still
Wizards-specific — the palette is six custom properties at the top of `:root`.

---

## Notes for anyone editing the fetch script

**Verify keyword argument names before changing an endpoint call.** `nba_api`
parameter names are inconsistent between endpoints — `team_id` vs
`team_id_nullable`, `season_type` vs `season_type_all_star` vs
`season_type_nullable`. Guessing wrong usually returns empty results rather
than raising, which is a confusing way to lose an afternoon. Check first:

```python
import inspect
from nba_api.stats.endpoints import leaguedashplayerstats
print(inspect.signature(leaguedashplayerstats.LeagueDashPlayerStats.__init__))
```

**Calls are spaced 0.6s apart on purpose.** stats.nba.com throttles hard and
starts timing out without spacing. `REQUEST_DELAY_SECONDS` and
`REQUEST_TIMEOUT_SECONDS` are in `config.py`.

**Per-game values are requested from the API** (`per_mode_detailed="PerGame"`),
never divided out of totals, and rounding happens in Python so the front end
does no arithmetic on stats.

**The roster drives the player join.** Stats are left-joined onto
`commonteamroster` on `PLAYER_ID`, so two-way and inactive players still appear
with `null` stats instead of silently vanishing. The front end renders those as
`—` and always sorts them to the bottom, in both directions.

`leaguedashplayerstats` returns more rows than the roster has players — it
includes anyone who suited up for the team at some point during the season, and
their row carries whatever team they're on now. The roster-driven join drops
them.

**`teamgamelogs`, not `teamgamelog`.** The v1 endpoint returns the team's score
but not the opponent's, which `games.json` needs. The v2 endpoint returns the
same rows plus `PLUS_MINUS`, so `opp_score = PTS - PLUS_MINUS`.

---

## Troubleshooting

**The fetch script fails with proxy or connection errors.**
stats.nba.com blocks most cloud and datacenter IP ranges. Run it from a normal
home or office connection — from a hosted environment that's the network, not
the code.

**The page shows "Could not load the dashboard data."**
Either the page is being opened as `file://` (see above), or `data/` is empty
because the fetch hasn't been run yet. The exact failure is printed in the
banner.

**Stats are empty for players who clearly played.**
Check `SEASON` in `config.py` against the season you meant.

**The footer date looks old.**
That's the point — the footer shows `meta.last_updated` so stale data is
obvious. Re-run the fetch.
