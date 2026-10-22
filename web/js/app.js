/* Washington Wizards dashboard - vanilla JS, no framework, no bundler.
 *
 * Reads the static JSON written by fetch/fetch_data.py. Every number arrives
 * pre-rounded, so nothing here does arithmetic on stats.
 *
 * Must be served over HTTP: opening index.html as file:// makes fetch() fail
 * on CORS. See the README.
 */

'use strict';

var DATA_BASE = '../data/';

var state = {
  team: null,
  players: [],
  games: [],
  meta: null
};

/* Single object holds the whole player-table view. */
var tableView = {
  sortKey: 'pts',
  sortDir: 'desc',
  filter: ''
};

function el(id) {
  return document.getElementById(id);
}

/* --- formatting ----------------------------------------------------------- */

/* Null stats render as an em dash everywhere. */
function dash(value) {
  return value === null || value === undefined || value === '' ? '—' : value;
}

function ordinal(n) {
  if (n === null || n === undefined) {
    return '—';
  }
  var mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return n + 'th';
  }
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

/* 0.207 -> "20.7%", 1.0 -> "100%". Rounded to one decimal; whole numbers
 * drop the ".0". */
function formatPct(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  return Math.round(value * 1000) / 10 + '%';
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* "2026-04-12" -> "Apr 12". Split by hand rather than new Date(), which reads
 * a bare ISO date as UTC and can shift it a day west of Greenwich. */
function formatGameDate(iso) {
  var parts = String(iso).split('-');
  if (parts.length !== 3) {
    return dash(iso);
  }
  var month = MONTHS[parseInt(parts[1], 10) - 1];
  return month ? month + ' ' + parseInt(parts[2], 10) : dash(iso);
}

/* meta.last_updated is a full timestamp, so Date is safe here. */
function formatTimestamp(iso) {
  var when = new Date(iso);
  if (isNaN(when.getTime())) {
    return dash(iso);
  }
  return when.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/* --- loading -------------------------------------------------------------- */

function loadJSON(name) {
  return fetch(DATA_BASE + name, { cache: 'no-store' }).then(function (response) {
    if (!response.ok) {
      throw new Error(name + ' — HTTP ' + response.status);
    }
    return response.json();
  });
}

function showError(error) {
  el('loading').hidden = true;
  el('dashboard').hidden = true;

  var banner = el('error');
  banner.hidden = false;

  var title = document.createElement('strong');
  title.textContent = 'Could not load the dashboard data.';

  var detail = document.createElement('p');
  detail.style.margin = '0';
  detail.textContent =
    'Check that fetch/fetch_data.py has been run, and that the page is being ' +
    'served over HTTP (python -m http.server 8000) rather than opened as a file.';

  var code = document.createElement('code');
  code.textContent = error && error.message ? error.message : String(error);

  banner.replaceChildren(title, detail, code);
}

function init() {
  Promise.all([
    loadJSON('team.json'),
    loadJSON('players.json'),
    loadJSON('games.json'),
    loadJSON('meta.json')
  ]).then(function (results) {
    state.team = results[0];
    state.players = results[1];
    state.games = results[2];
    state.meta = results[3];

    render();
    wirePlayerFilter();

    el('loading').hidden = true;
    el('dashboard').hidden = false;
  }).catch(showError);
}

/* --- rendering ------------------------------------------------------------ */

function render() {
  renderHeader();
  renderStatCards();
  renderRecentGames();
  renderPlayerTable();
  renderFooter();
}

function renderHeader() {
  var team = state.team || {};
  var meta = state.meta || {};

  if (meta.season) {
    el('season-label').textContent = meta.season + ' season';
  }

  if (team.wins !== null && team.wins !== undefined) {
    var badge = el('record-badge');
    badge.textContent = team.wins + '–' + team.losses;
    badge.hidden = false;
  }
}

function statCard(label, value, note, tone) {
  var card = document.createElement('div');
  card.className = 'stat-card';

  var labelEl = document.createElement('p');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;

  var valueEl = document.createElement('p');
  valueEl.className = 'stat-value' + (tone ? ' is-' + tone : '');
  valueEl.textContent = value;

  card.append(labelEl, valueEl);

  if (note) {
    var noteEl = document.createElement('p');
    noteEl.className = 'stat-note';
    noteEl.textContent = note;
    card.append(noteEl);
  }
  return card;
}

function renderStatCards() {
  var team = state.team || {};

  var record = (team.wins === null || team.wins === undefined)
    ? '—'
    : team.wins + '–' + team.losses;

  /* Win pct leads the note, then the home/road split. Any piece the API left
     out is dropped rather than rendered as an em dash. */
  var recordNote = [];
  if (team.win_pct !== null && team.win_pct !== undefined) {
    recordNote.push(formatPct(team.win_pct) + ' win pct');
  }
  if (team.home_record) {
    recordNote.push(team.home_record + ' home');
  }
  if (team.road_record) {
    recordNote.push(team.road_record + ' road');
  }
  recordNote = recordNote.join('  ·  ');

  var seedNote = team.conference ? 'in the ' + team.conference : '';

  /* streak reads "W2" / "L10" - first character carries the colour. */
  var streak = team.streak || '';
  var streakTone = streak.charAt(0) === 'W'
    ? 'win'
    : (streak.charAt(0) === 'L' ? 'loss' : '');

  var cards = [
    statCard('Record', record, recordNote),
    statCard('Conference seed', ordinal(team.conference_rank), seedNote),
    statCard('Points per game', dash(team.points_per_game), 'scored'),
    statCard('Opponent PPG', dash(team.opp_points_per_game), 'allowed'),
    statCard('Current streak', dash(streak), '', streakTone),
    statCard('Last 10', dash(team.last_10), '')
  ];

  el('stat-cards').replaceChildren.apply(el('stat-cards'), cards);
}

function renderRecentGames() {
  /* games.json is written most-recent-first. */
  var recent = (state.games || []).slice(0, 5);
  var list = el('recent-games');

  if (!recent.length) {
    var empty = document.createElement('li');
    empty.className = 'game-row';
    empty.textContent = 'No games recorded for this season.';
    list.replaceChildren(empty);
    return;
  }

  var rows = recent.map(function (game) {
    var row = document.createElement('li');
    row.className = 'game-row';

    var won = game.result === 'W';

    var pill = document.createElement('span');
    pill.className = 'pill ' + (won ? 'is-win' : 'is-loss');
    pill.textContent = dash(game.result);

    var date = document.createElement('span');
    date.className = 'game-date';
    date.textContent = formatGameDate(game.date);

    var opponent = document.createElement('span');
    opponent.className = 'game-opponent';
    var prefix = document.createElement('span');
    prefix.className = 'at';
    prefix.textContent = game.home ? 'vs ' : '@ ';
    opponent.append(prefix, document.createTextNode(dash(game.opponent)));

    var score = document.createElement('span');
    score.className = 'game-score';
    score.textContent = dash(game.team_score) + '–' + dash(game.opp_score);

    row.append(pill, date, opponent, score);
    return row;
  });

  list.replaceChildren.apply(list, rows);
}

/* --- player table --------------------------------------------------------- */

/* Jersey numbers arrive as strings ("00", "3"); sort them numerically. */
function numericSort(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  var n = Number(value);
  return isNaN(n) ? null : n;
}

/* "6-9" -> 81 inches, so the column sorts by actual height. */
function heightSort(value) {
  if (!value) {
    return null;
  }
  var parts = String(value).split('-');
  if (parts.length !== 2) {
    return null;
  }
  var feet = Number(parts[0]);
  var inches = Number(parts[1]);
  return isNaN(feet) || isNaN(inches) ? null : feet * 12 + inches;
}

/* Roster experience is "R" for rookies, otherwise a year count. */
function experienceSort(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (String(value).toUpperCase() === 'R') {
    return 0;
  }
  return numericSort(value);
}

function formatExperience(value) {
  return String(value).toUpperCase() === 'R' ? 'R' : dash(value);
}

/* label      - header text
   key        - field on the player object
   type       - 'text' left-aligns; anything else right-aligns
   sortValue  - value used for ordering (null sorts to the bottom always)
   format     - display string */
var COLUMNS = [
  { label: 'Player', key: 'name', type: 'text',
    sortValue: function (p) { return p.name ? p.name.toLowerCase() : null; },
    format: function (p) { return dash(p.name); } },
  { label: '#', key: 'number',
    sortValue: function (p) { return numericSort(p.number); },
    format: function (p) { return dash(p.number); } },
  { label: 'Pos', key: 'position', type: 'text',
    sortValue: function (p) { return p.position ? p.position.toLowerCase() : null; },
    format: function (p) { return dash(p.position); } },
  { label: 'Ht', key: 'height',
    sortValue: function (p) { return heightSort(p.height); },
    format: function (p) { return dash(p.height); } },
  { label: 'Wt', key: 'weight',
    sortValue: function (p) { return numericSort(p.weight); },
    format: function (p) { return dash(p.weight); } },
  { label: 'Exp', key: 'experience',
    sortValue: function (p) { return experienceSort(p.experience); },
    format: function (p) { return formatExperience(p.experience); } },
  { label: 'GP', key: 'gp' },
  { label: 'MIN', key: 'min' },
  { label: 'PTS', key: 'pts' },
  { label: 'REB', key: 'reb' },
  { label: 'AST', key: 'ast' },
  { label: 'STL', key: 'stl' },
  { label: 'BLK', key: 'blk' },
  { label: 'FG%', key: 'fg_pct', pct: true },
  { label: '3P%', key: 'fg3_pct', pct: true },
  { label: 'FT%', key: 'ft_pct', pct: true }
];

/* Plain stat columns share one numeric sort and one formatter. */
COLUMNS.forEach(function (column) {
  if (!column.sortValue) {
    column.sortValue = function (p) {
      var v = p[column.key];
      return v === null || v === undefined ? null : v;
    };
  }
  if (!column.format) {
    column.format = column.pct
      ? function (p) { return formatPct(p[column.key]); }
      : function (p) { return dash(p[column.key]); };
  }
});

function columnByKey(key) {
  for (var i = 0; i < COLUMNS.length; i++) {
    if (COLUMNS[i].key === key) {
      return COLUMNS[i];
    }
  }
  return null;
}

function visiblePlayers() {
  var needle = tableView.filter.trim().toLowerCase();
  var rows = (state.players || []).filter(function (player) {
    return !needle || (player.name || '').toLowerCase().indexOf(needle) > -1;
  });

  var column = columnByKey(tableView.sortKey);
  if (!column) {
    return rows;
  }

  var direction = tableView.sortDir === 'asc' ? 1 : -1;

  /* Sort a copy - state.players keeps the order it was loaded in. */
  return rows.slice().sort(function (a, b) {
    var left = column.sortValue(a);
    var right = column.sortValue(b);

    /* Nulls sink to the bottom in both directions. */
    var leftNull = left === null || left === undefined;
    var rightNull = right === null || right === undefined;
    if (leftNull || rightNull) {
      if (leftNull && rightNull) {
        return 0;
      }
      return leftNull ? 1 : -1;
    }

    if (left < right) { return -1 * direction; }
    if (left > right) { return 1 * direction; }
    return 0;
  });
}

function renderTableHead() {
  var headers = COLUMNS.map(function (column) {
    var th = document.createElement('th');
    th.textContent = column.label;
    th.scope = 'col';
    th.tabIndex = 0;

    var active = column.key === tableView.sortKey;
    th.setAttribute(
      'aria-sort',
      active ? (tableView.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
    );
    if (active) {
      th.classList.add('is-sorted');
    }

    function activate() {
      /* New column starts descending; the same column toggles. */
      if (tableView.sortKey === column.key) {
        tableView.sortDir = tableView.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        tableView.sortKey = column.key;
        tableView.sortDir = 'desc';
      }
      renderPlayerTable();
    }

    th.addEventListener('click', activate);
    th.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });

    return th;
  });

  var head = el('player-table-head');
  head.replaceChildren.apply(head, headers);
}

function renderPlayerTable() {
  renderTableHead();

  var rows = visiblePlayers();
  var body = el('player-table-body');

  var tableRows = rows.map(function (player) {
    var tr = document.createElement('tr');

    COLUMNS.forEach(function (column, index) {
      var cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) {
        cell.scope = 'row';
        cell.className = 'player-name';
      }

      var value = player[column.key];
      if (value === null || value === undefined || value === '') {
        cell.classList.add('is-null');
      }
      cell.textContent = column.format(player);
      tr.append(cell);
    });

    return tr;
  });

  body.replaceChildren.apply(body, tableRows);

  /* Header row stays put when the filter matches nothing, so the message
     reads as "no matches" rather than as a broken table. */
  el('table-empty').hidden = rows.length > 0;
}

function wirePlayerFilter() {
  el('player-filter').addEventListener('input', function (event) {
    tableView.filter = event.target.value;
    renderPlayerTable();
  });
}

function renderFooter() {
  var meta = state.meta || {};
  var parts = [];

  if (meta.last_updated) {
    parts.push('Data last pulled ' + formatTimestamp(meta.last_updated));
  }
  if (meta.season) {
    parts.push(meta.season + ' regular season');
  }

  el('last-updated').textContent = parts.length
    ? parts.join('  ·  ')
    : '—';
}

document.addEventListener('DOMContentLoaded', init);
