"""Configuration for the Wizards dashboard data fetch.

TEAM_ID and SEASON live here and nowhere else.
"""

import os

TEAM_ID = 1610612764  # Washington Wizards
SEASON = "2026-27"

# Paths -----------------------------------------------------------------------

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

TEAM_JSON = os.path.join(DATA_DIR, "team.json")
PLAYERS_JSON = os.path.join(DATA_DIR, "players.json")
GAMES_JSON = os.path.join(DATA_DIR, "games.json")
META_JSON = os.path.join(DATA_DIR, "meta.json")

# API behaviour ---------------------------------------------------------------

# stats.nba.com throttles hard; space every call out.
REQUEST_DELAY_SECONDS = 0.6
REQUEST_TIMEOUT_SECONDS = 30
