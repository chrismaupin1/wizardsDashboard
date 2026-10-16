#!/usr/bin/env python3
"""Pull Washington Wizards data from the NBA stats API and write data/*.json.

Run from the project root:

    python fetch/fetch_data.py

Each endpoint is fetched in isolation: if one fails the others still write, and
the script exits 1 so a caller can tell something was missing.

Note: stats.nba.com blocks most cloud/datacenter IP ranges. Proxy or connection
errors from a hosted environment are the network, not this code.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import datetime, timezone

try:
    import config
except ModuleNotFoundError:  # invoked as `python -m fetch.fetch_data`
    from . import config  # type: ignore[no-redef]

from nba_api.stats.endpoints import (
    commonteamroster,
    leaguedashplayerstats,
    leaguestandingsv3,
    teamgamelogs,
    teamyearbyyearstats,
)


# --- small helpers -----------------------------------------------------------


def _is_missing(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return False


def num(value, digits: int = 1):
    """Round to `digits` places, or None if the API gave us nothing.

    All per-game rounding happens here so the front end does zero math.
    """
    if _is_missing(value):
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def integer(value):
    if _is_missing(value):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def text(value) -> str:
    if _is_missing(value):
        return ""
    return str(value).strip()


def log(message: str) -> None:
    print(message, flush=True)


def write_json(path: str, payload) -> None:
    """Write atomically: full file to <path>.tmp, then os.replace() into place.

    Keeps the page from ever reading a half-written file if it refreshes
    mid-run.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    log(f"  wrote {os.path.relpath(path, config.PROJECT_ROOT)}")


class Fetcher:
    """Runs each endpoint call in isolation and records what failed."""

    def __init__(self) -> None:
        self.failures: list[str] = []
        self._called = False

    def get(self, label: str, build):
        """Call `build()`, returning its DataFrame or None on failure."""
        if self._called:
            # stats.nba.com throttles hard; space every call out.
            time.sleep(config.REQUEST_DELAY_SECONDS)
        self._called = True

        log(f"fetching {label} ...")
        try:
            frame = build()
        except Exception as exc:  # noqa: BLE001 - any failure is per-endpoint
            self.failures.append(label)
            log(f"  FAILED {label}: {type(exc).__name__}: {exc}")
            return None
        log(f"  ok ({len(frame)} rows)")
        return frame


# --- endpoint calls ----------------------------------------------------------
#
# Keyword names differ between endpoints (`team_id` vs `team_id_nullable`,
# `season_type` vs `season_type_all_star` vs `season_type_nullable`). Each call
# below was checked against inspect.signature() before being written; re-check
# with the snippet in the README before changing one.


def fetch_standings(fetcher: Fetcher):
    def build():
        frame = leaguestandingsv3.LeagueStandingsV3(
            season=config.SEASON,
            season_type="Regular Season",
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        ).get_data_frames()[0]
        return frame[frame["TeamID"] == config.TEAM_ID]

    return fetcher.get("leaguestandingsv3", build)


def fetch_year_by_year(fetcher: Fetcher):
    def build():
        frame = teamyearbyyearstats.TeamYearByYearStats(
            team_id=config.TEAM_ID,
            per_mode_simple="PerGame",
            season_type_all_star="Regular Season",
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        ).get_data_frames()[0]
        return frame[frame["YEAR"] == config.SEASON]

    return fetcher.get("teamyearbyyearstats", build)


def fetch_roster(fetcher: Fetcher):
    def build():
        return commonteamroster.CommonTeamRoster(
            team_id=config.TEAM_ID,
            season=config.SEASON,
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        ).get_data_frames()[0]

    return fetcher.get("commonteamroster", build)


def fetch_player_stats(fetcher: Fetcher):
    def build():
        # PerGame comes from the API on purpose - never divided out of totals.
        return leaguedashplayerstats.LeagueDashPlayerStats(
            season=config.SEASON,
            season_type_all_star="Regular Season",
            team_id_nullable=config.TEAM_ID,
            per_mode_detailed="PerGame",
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        ).get_data_frames()[0]

    return fetcher.get("leaguedashplayerstats", build)


def fetch_games(fetcher: Fetcher):
    # teamgamelogs (v2) rather than teamgamelog (v1): the contract needs
    # opp_score, and only v2 returns PLUS_MINUS to derive it from. Same data
    # otherwise, and GAME_DATE arrives already ISO-formatted.
    def build():
        return teamgamelogs.TeamGameLogs(
            team_id_nullable=config.TEAM_ID,
            season_nullable=config.SEASON,
            season_type_nullable="Regular Season",
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        ).get_data_frames()[0]

    return fetcher.get("teamgamelogs", build)


# --- shaping into the JSON contracts -----------------------------------------


def build_team(standings, year_by_year) -> dict:
    standing = standings.iloc[0] if standings is not None and len(standings) else None
    season = (
        year_by_year.iloc[0]
        if year_by_year is not None and len(year_by_year)
        else None
    )

    team_name = "Washington Wizards"
    if standing is not None:
        team_name = f"{text(standing['TeamCity'])} {text(standing['TeamName'])}".strip()

    # Standings carries both scoring averages; year-by-year only has our own,
    # so it serves as the fallback for points_per_game.
    points = num(standing["PointsPG"]) if standing is not None else None
    if points is None and season is not None:
        points = num(season["PTS"])

    # "L 10" -> "L10"
    streak = ""
    if standing is not None:
        streak = "".join(text(standing["strCurrentStreak"]).split())

    return {
        "team_name": team_name,
        "wins": integer(standing["WINS"]) if standing is not None else None,
        "losses": integer(standing["LOSSES"]) if standing is not None else None,
        "win_pct": num(standing["WinPCT"], 3) if standing is not None else None,
        "conference": text(standing["Conference"]) if standing is not None else "",
        "conference_rank": (
            integer(standing["PlayoffRank"]) if standing is not None else None
        ),
        "points_per_game": points,
        "opp_points_per_game": (
            num(standing["OppPointsPG"]) if standing is not None else None
        ),
        "streak": streak,
        "last_10": text(standing["L10"]) if standing is not None else "",
        "home_record": text(standing["HOME"]) if standing is not None else "",
        "road_record": text(standing["ROAD"]) if standing is not None else "",
    }


def build_players(roster, stats) -> list[dict]:
    """Left-join stats onto the roster on PLAYER_ID.

    Roster-driven so two-way and inactive players still appear with null stats
    instead of silently disappearing.
    """
    by_player_id: dict[int, dict] = {}
    if stats is not None:
        for _, row in stats.iterrows():
            player_id = integer(row["PLAYER_ID"])
            # A traded player can surface more than once; first row wins.
            if player_id is not None and player_id not in by_player_id:
                by_player_id[player_id] = row

    players: list[dict] = []
    for _, row in roster.iterrows():
        player_id = integer(row["PLAYER_ID"])
        stat = by_player_id.get(player_id)

        players.append(
            {
                "player_id": player_id,
                "name": text(row["PLAYER"]),
                "number": text(row["NUM"]),
                "position": text(row["POSITION"]),
                "height": text(row["HEIGHT"]),
                "weight": text(row["WEIGHT"]),
                "experience": text(row["EXP"]),
                "gp": integer(stat["GP"]) if stat is not None else None,
                "min": num(stat["MIN"]) if stat is not None else None,
                "pts": num(stat["PTS"]) if stat is not None else None,
                "reb": num(stat["REB"]) if stat is not None else None,
                "ast": num(stat["AST"]) if stat is not None else None,
                "stl": num(stat["STL"]) if stat is not None else None,
                "blk": num(stat["BLK"]) if stat is not None else None,
                "fg_pct": num(stat["FG_PCT"], 3) if stat is not None else None,
                "fg3_pct": num(stat["FG3_PCT"], 3) if stat is not None else None,
                "ft_pct": num(stat["FT_PCT"], 3) if stat is not None else None,
            }
        )

    missing = sum(1 for p in players if p["gp"] is None)
    if missing:
        log(f"  {missing} roster player(s) had no stats row; written as null")

    # Scorers first, players without stats last - the front end re-sorts anyway.
    players.sort(key=lambda p: (p["pts"] is None, -(p["pts"] or 0.0)))
    return players


def build_games(games) -> list[dict]:
    records: list[dict] = []
    for _, row in games.iterrows():
        matchup = text(row["MATCHUP"])  # "WAS @ CLE" or "WAS vs. MIA"
        home = "@" not in matchup
        opponent = matchup.replace("vs.", "@").split("@")[-1].strip()

        team_score = integer(row["PTS"])
        margin = num(row["PLUS_MINUS"], 0)
        opp_score = (
            None
            if team_score is None or margin is None
            else team_score - int(margin)
        )

        records.append(
            {
                "date": text(row["GAME_DATE"])[:10],  # "2026-04-12T00:00:00"
                "opponent": opponent,
                "home": home,
                "result": text(row["WL"]),
                "team_score": team_score,
                "opp_score": opp_score,
            }
        )

    records.sort(key=lambda g: g["date"], reverse=True)  # most recent first
    return records


# --- entry point -------------------------------------------------------------


def main() -> int:
    log(f"Wizards dashboard fetch - team {config.TEAM_ID}, season {config.SEASON}")
    fetcher = Fetcher()

    standings = fetch_standings(fetcher)
    year_by_year = fetch_year_by_year(fetcher)
    roster = fetch_roster(fetcher)
    player_stats = fetch_player_stats(fetcher)
    games = fetch_games(fetcher)

    log("writing data/")

    if standings is not None or year_by_year is not None:
        write_json(config.TEAM_JSON, build_team(standings, year_by_year))
    else:
        log("  skipped team.json (no standings or year-by-year data)")

    if roster is not None:
        write_json(config.PLAYERS_JSON, build_players(roster, player_stats))
    else:
        log("  skipped players.json (no roster)")

    if games is not None:
        write_json(config.GAMES_JSON, build_games(games))
    else:
        log("  skipped games.json (no game log)")

    write_json(
        config.META_JSON,
        {
            "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "season": config.SEASON,
        },
    )

    if fetcher.failures:
        log(f"\nDone with errors. Failed endpoints: {', '.join(fetcher.failures)}")
        return 1

    log("\nDone. All endpoints succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
