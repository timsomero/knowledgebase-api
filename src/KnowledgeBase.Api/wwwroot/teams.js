// Team color themes: a picker screen (#teams) with a drawn helmet per NFL team.
// Helmets are simple drawings in each team's colors, not the teams' logos.
// The choice is remembered per device in localStorage.

(function () {
  const STORAGE_KEY = 'kb_team';

  // shell/mask/stripe: helmet drawing. primary/secondary: app theme.
  const DIVISIONS = [
    ['AFC East', [
      ['buf', 'Bills', 'Buffalo', '#00338D', '#C60C30', '#FFFFFF', '#00338D', '#C60C30'],
      ['mia', 'Dolphins', 'Miami', '#008E97', '#FC4C02', '#FFFFFF', '#008E97', '#FC4C02'],
      ['ne', 'Patriots', 'New England', '#002244', '#C60C30', '#B0B7BC', '#002244', '#C60C30'],
      ['nyj', 'Jets', 'New York', '#125740', '#FFFFFF', '#125740', '#FFFFFF', '#FFFFFF'],
    ]],
    ['AFC North', [
      ['bal', 'Ravens', 'Baltimore', '#241773', '#9E7C0C', '#111111', '#111111', '#241773'],
      ['cin', 'Bengals', 'Cincinnati', '#FB4F14', '#111111', '#FB4F14', '#111111', '#111111'],
      ['cle', 'Browns', 'Cleveland', '#311D00', '#FF3C00', '#FF3C00', '#311D00', '#311D00'],
      ['pit', 'Steelers', 'Pittsburgh', '#101820', '#FFB612', '#101820', '#101820', '#FFB612'],
    ]],
    ['AFC South', [
      ['hou', 'Texans', 'Houston', '#03202F', '#A71930', '#03202F', '#03202F', '#A71930'],
      ['ind', 'Colts', 'Indianapolis', '#002C5F', '#A2AAAD', '#FFFFFF', '#002C5F', '#002C5F'],
      ['jax', 'Jaguars', 'Jacksonville', '#006778', '#D7A22A', '#101820', '#101820', '#006778'],
      ['ten', 'Titans', 'Tennessee', '#0C2340', '#4B92DB', '#FFFFFF', '#0C2340', '#4B92DB'],
    ]],
    ['AFC West', [
      ['den', 'Broncos', 'Denver', '#FB4F14', '#002244', '#002244', '#002244', '#FB4F14'],
      ['kc', 'Chiefs', 'Kansas City', '#E31837', '#FFB81C', '#E31837', '#FFFFFF', '#FFFFFF'],
      ['lv', 'Raiders', 'Las Vegas', '#000000', '#A5ACAF', '#A5ACAF', '#000000', '#000000'],
      ['lac', 'Chargers', 'Los Angeles', '#0080C6', '#FFC20E', '#FFFFFF', '#0080C6', '#FFC20E'],
    ]],
    ['NFC East', [
      ['dal', 'Cowboys', 'Dallas', '#041E42', '#869397', '#B0B7BC', '#041E42', '#041E42'],
      ['nyg', 'Giants', 'New York', '#0B2265', '#A71930', '#0B2265', '#A5ACAF', '#A71930'],
      ['phi', 'Eagles', 'Philadelphia', '#004C54', '#A5ACAF', '#004C54', '#111111', '#A5ACAF'],
      ['was', 'Commanders', 'Washington', '#5A1414', '#FFB612', '#5A1414', '#5A1414', '#FFB612'],
    ]],
    ['NFC North', [
      ['chi', 'Bears', 'Chicago', '#0B162A', '#C83803', '#0B162A', '#0B162A', '#C83803'],
      ['det', 'Lions', 'Detroit', '#0076B6', '#B0B7BC', '#B0B7BC', '#0076B6', '#0076B6'],
      ['gb', 'Packers', 'Green Bay', '#203731', '#FFB612', '#FFB612', '#203731', '#203731'],
      ['min', 'Vikings', 'Minnesota', '#4F2683', '#FFC62F', '#4F2683', '#4F2683', '#FFC62F'],
    ]],
    ['NFC South', [
      ['atl', 'Falcons', 'Atlanta', '#A71930', '#000000', '#111111', '#111111', '#A71930'],
      ['car', 'Panthers', 'Carolina', '#0085CA', '#101820', '#BFC0BF', '#101820', '#0085CA'],
      ['no', 'Saints', 'New Orleans', '#101820', '#D3BC8D', '#D3BC8D', '#101820', '#101820'],
      ['tb', 'Buccaneers', 'Tampa Bay', '#D50A0A', '#34302B', '#34302B', '#111111', '#D50A0A'],
    ]],
    ['NFC West', [
      ['ari', 'Cardinals', 'Arizona', '#97233F', '#000000', '#FFFFFF', '#97233F', '#97233F'],
      ['lar', 'Rams', 'Los Angeles', '#003594', '#FFA300', '#003594', '#003594', '#FFA300'],
      ['sf', '49ers', 'San Francisco', '#AA0000', '#B3995D', '#B3995D', '#AA0000', '#AA0000'],
      ['sea', 'Seahawks', 'Seattle', '#002244', '#69BE28', '#002244', '#A5ACAF', '#69BE28'],
    ]],
  ];

  const TEAMS = {};
  for (const [, teams] of DIVISIONS)
    for (const [id, name, city, primary, secondary, shell, mask, stripe] of teams)
      TEAMS[id] = { id, name, city, primary, secondary, shell, mask, stripe };

  // ---------- color helpers (WCAG contrast) ----------

  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  const readableOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

  // ---------- helmet drawing ----------

  function helmetSvg(t) {
    // Side view facing right. The stripe and ear hole are clipped to the shell.
    const id = `clip-${t.id}`;
    const outline = luminance(t.shell) > 0.6 ? '#9aa1ad' : 'none';
    return `<svg viewBox="0 0 100 76" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${SHELL}"/></clipPath></defs>
      <path d="${SHELL}" fill="${t.shell}" stroke="${outline}" stroke-width="1.2"/>
      <g clip-path="url(#${id})">
        <path d="M88 30 C80 12 56 4 36 10 C22 14 12 26 10 44" fill="none" stroke="${t.stripe}" stroke-width="7"/>
      </g>
      <circle cx="44" cy="42" r="3.5" fill="#00000055"/>
      <g fill="none" stroke="${t.mask}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M74 40 L96 40 L96 62 L70 62"/>
        <path d="M80 40 L80 62 M88 40 L88 62 M74 51 L96 51"/>
      </g>
    </svg>`;
  }
  const SHELL = 'M10 50 C6 26 24 6 50 6 C74 6 90 20 90 38 L90 44 L72 44 L66 62 L24 62 C16 62 11 57 10 50 Z';

  // ---------- applying a theme ----------

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let current = null;

  function apply(teamId) {
    current = TEAMS[teamId] || null;
    const root = document.documentElement.style;
    const props = ['--accent', '--on-accent', '--header-bg', '--header-text', '--header-stripe'];
    if (!current) {
      props.forEach((p) => root.removeProperty(p));
    } else {
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || (darkQuery.matches ? '#111317' : '#ffffff');
      // The accent marks buttons, checkboxes and links, so it has to stand out from the page:
      // use the primary color, else the secondary, else whichever contrasts more.
      const accent = [current.primary, current.secondary].find((c) => contrast(c, bg) >= 3)
        ?? [current.primary, current.secondary].sort((a, b) => contrast(b, bg) - contrast(a, bg))[0];
      root.setProperty('--accent', accent);
      root.setProperty('--on-accent', readableOn(accent));
      root.setProperty('--header-bg', current.primary);
      root.setProperty('--header-text', readableOn(current.primary));
      root.setProperty('--header-stripe', current.secondary);
    }
    document.querySelector('meta[name="theme-color"]')
      .setAttribute('content', current ? current.primary : '#2563eb');
    document.querySelectorAll('#team-grid .team').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.team === (current?.id ?? ''))));
  }

  function choose(teamId) {
    try {
      if (teamId) localStorage.setItem(STORAGE_KEY, teamId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable; the theme lasts until the page is closed */ }
    apply(teamId);
  }

  // ---------- picker screen ----------

  function teamButton(t) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'team';
    b.dataset.team = t ? t.id : '';
    b.innerHTML = t
      ? `${helmetSvg(t)}<span>${t.name}</span>`
      : '<span class="default-swatch"></span><span>Default</span>';
    b.title = t ? `${t.city} ${t.name}` : 'Default colors';
    b.addEventListener('click', () => {
      choose(t ? t.id : null);
      closePicker();
    });
    return b;
  }

  function buildGrid() {
    const grid = document.getElementById('team-grid');
    const defaults = document.createElement('div');
    defaults.className = 'division';
    defaults.append(teamButton(null));
    grid.append(defaults);
    for (const [division, teams] of DIVISIONS) {
      const h = document.createElement('h3');
      h.textContent = division;
      const row = document.createElement('div');
      row.className = 'division';
      row.append(...teams.map(([id]) => teamButton(TEAMS[id])));
      grid.append(h, row);
    }
  }

  // The picker is reached via #teams, so the phone's back button closes it.
  let openedInApp = false;

  function syncWithHash() {
    document.body.classList.toggle('teams-open', location.hash === '#teams');
    if (location.hash === '#teams') window.scrollTo(0, 0);
  }

  function closePicker() {
    if (openedInApp) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
    openedInApp = false;
    syncWithHash();
  }

  document.getElementById('open-teams').addEventListener('click', () => {
    openedInApp = true;
  });
  document.getElementById('close-teams').addEventListener('click', closePicker);
  window.addEventListener('hashchange', syncWithHash);
  darkQuery.addEventListener('change', () => apply(current?.id));

  buildGrid();
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  apply(saved);
  syncWithHash();
})();
