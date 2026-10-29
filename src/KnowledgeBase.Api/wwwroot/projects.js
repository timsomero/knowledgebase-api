// Work mode's Projects board: capacity bars per person, a tile per long-running project, the panel a tile
// opens (health, Checked in), and Manage projects (#projects) with the team list.
// Uses $, api, showError, showToast, settings and shortName from app.js, knownPeople from person-picker.js
// and setStatus from workouts.js.

let projects = [];
let editingProjectId = null; // the project in Manage's form, or null to add one
let sheetProjectId = null;   // the project the panel shows

// A size is roughly this share of one person's time, split evenly between the people carrying it.
const SIZE_PCT = { small: 10, medium: 25, large: 50 };
const SIZE_LETTER = { small: 'S', medium: 'M', large: 'L' };
const SIZE_NAME = { small: 'Small', medium: 'Medium', large: 'Large' };
const HEALTH_NAME = { on_track: 'On track', needs_attention: 'Needs attention', blocked: 'Blocked' };
// A project not checked in for this many days fades on the board.
const STALE_DAYS = 14;
const AVATAR_COLORS = ['#5eead4', '#93c5fd', '#f9a8d4', '#fcd34d', '#c4b5fd', '#fdba74'];

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);
const isStale = (project) => daysSince(project.lastCheckedIn) >= STALE_DAYS;

// Everyone the capacity bars show: You, the team from Manage (until it is first saved, the people tasks
// are delegated to), and anyone else carrying a project.
function teamMembers() {
  const names = ['You', ...(settings.team ?? knownPeople())];
  for (const person of projects.flatMap((p) => p.people))
    if (!names.some((n) => sameName(n, person))) names.push(person);
  return names;
}

// Percent of each person's time taken by the projects they carry, by lower-case name.
function loads() {
  const load = new Map();
  for (const p of projects) {
    const share = SIZE_PCT[p.size] / Math.max(1, p.people.length);
    for (const person of p.people) load.set(person.toLowerCase(), (load.get(person.toLowerCase()) ?? 0) + share);
  }
  return load;
}

function formatTarget(date, withYear = true) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', year: 'numeric' });
}

function avatar(name) {
  const span = document.createElement('span');
  span.className = 'avatar';
  span.textContent = name.trim().charAt(0).toUpperCase();
  span.title = name;
  const hash = [...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  span.style.background = sameName(name, 'You') ? AVATAR_COLORS[0] : AVATAR_COLORS[1 + (hash % (AVATAR_COLORS.length - 1))];
  return span;
}

function healthBadge(health, label = HEALTH_NAME[health]) {
  const span = document.createElement('span');
  span.className = `health ${health}`;
  const dot = document.createElement('span');
  dot.className = `dot ${health}`;
  span.append(dot, label);
  return span;
}

// ---------- the board ----------

async function showProjectsBoard() {
  renderBoard();
  try {
    projects = await api('/projects');
    renderBoard();
    if (sheetProjectId) renderSheet();
  } catch (err) {
    showError(err);
  }
}

function renderBoard() {
  const load = loads();
  $('capacity-bars').replaceChildren(...teamMembers().map((name) => {
    const pct = Math.round(load.get(name.toLowerCase()) ?? 0);
    const row = document.createElement('div');
    row.className = 'capacity-row';
    const label = document.createElement('span');
    label.className = 'capacity-name';
    label.textContent = name;
    const track = document.createElement('span');
    track.className = 'capacity-track';
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', `${name}: ${pct}% busy`);
    track.setAttribute('aria-valuenow', String(pct));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('span');
    fill.className = `capacity-fill ${pct > 100 ? 'over' : pct >= 70 ? 'busy' : 'free'}`;
    fill.style.width = `${Math.min(pct, 100)}%`;
    track.append(fill);
    const value = document.createElement('span');
    value.className = 'capacity-pct';
    value.textContent = `${pct}%`;
    row.append(label, track, value);
    return row;
  }));

  const room = teamMembers().filter((name) => (load.get(name.toLowerCase()) ?? 0) + SIZE_PCT.medium <= 100);
  $('capacity-room').textContent = room.length ? `Room for a new M project: ${room.join(', ')}` : 'No one has room for a new M project.';
  $('capacity-room').classList.toggle('none', room.length === 0);

  // Blocked first, then the ones needing attention or not checked in lately, then the rest; bigger first.
  const rank = (p) => (p.health === 'blocked' ? 0 : p.health === 'needs_attention' || isStale(p) ? 1 : 2);
  const order = { large: 0, medium: 1, small: 2 };
  const sorted = [...projects].sort((a, b) => rank(a) - rank(b) || order[a.size] - order[b.size] || a.name.localeCompare(b.name));
  $('project-tiles').replaceChildren(...sorted.map(renderTile));
  $('projects-count').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  $('no-projects').hidden = projects.length > 0;
}

function renderTile(project) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `project-tile ${project.size} ${project.health}`;
  tile.classList.toggle('is-stale', isStale(project));

  const top = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;
  const category = document.createElement('span');
  category.className = 'project-category';
  category.textContent = project.category;
  top.append(name, category);

  const bottom = document.createElement('span');
  bottom.className = 'project-row';
  bottom.append(healthBadge(project.health, project.health === 'needs_attention' ? 'Attention' : HEALTH_NAME[project.health]));
  // A full-width tile has room for the note beside the health; a half-width one puts it on its own line.
  const note = document.createElement('span');
  note.className = 'project-note';
  if (isStale(project)) note.textContent = `Not checked in ${daysSince(project.lastCheckedIn)} days`;
  else if (project.targetDate && project.size === 'large') note.textContent = `Target ${formatTarget(project.targetDate, false)}`;
  if (project.size !== 'large' && note.textContent) {
    note.classList.add('own-line');
    top.append(note);
  }
  const spacer = document.createElement('span');
  spacer.className = 'project-spacer';
  const people = document.createElement('span');
  people.className = 'avatars';
  people.append(...project.people.map(avatar));
  const size = document.createElement('span');
  size.className = 'project-size';
  size.textContent = SIZE_LETTER[project.size];
  size.title = SIZE_NAME[project.size];
  bottom.append(project.size === 'large' ? note : spacer, people, size);

  tile.append(top, bottom);
  tile.setAttribute('aria-label', `${project.name}, ${HEALTH_NAME[project.health]}${isStale(project) ? `, not checked in for ${daysSince(project.lastCheckedIn)} days` : ''}`);
  tile.addEventListener('click', () => openSheet(project.id));
  return tile;
}

// ---------- the panel a tile opens ----------

function openSheet(id) {
  sheetProjectId = id;
  renderSheet();
  $('project-sheet').hidden = false;
  document.body.classList.add('sheet-open');
  $('sheet-checkin').focus({ preventScroll: true });
}

function closeSheet() {
  sheetProjectId = null;
  $('project-sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}

function renderSheet() {
  const project = projects.find((p) => p.id === sheetProjectId);
  if (!project) return closeSheet();
  $('sheet-title').textContent = project.name;
  $('sheet-category').textContent = project.category;

  const days = daysSince(project.lastCheckedIn);
  const when = new Date(project.lastCheckedIn).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('sheet-checked').textContent = days === 0 ? 'Checked in today' : days === 1 ? 'Last checked in yesterday' : `Last checked in ${days} days ago (${when})`;
  $('sheet-checked').classList.toggle('is-stale', isStale(project));

  for (const b of $('sheet-health').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === project.health));
  $('sheet-people').replaceChildren(...project.people.map((name) => {
    const chip = document.createElement('span');
    chip.className = 'person';
    chip.append(avatar(name), name);
    return chip;
  }));
  $('sheet-size').textContent = `${SIZE_NAME[project.size]} · about ${SIZE_PCT[project.size]}%`;
  $('sheet-target').textContent = project.targetDate ? formatTarget(project.targetDate) : 'None';
}

function replaceProject(updated) {
  projects = projects.map((p) => (p.id === updated.id ? updated : p));
  renderBoard();
  if (sheetProjectId === updated.id) renderSheet();
}

$('sheet-health').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !sheetProjectId) return;
  try {
    replaceProject(await api(`/projects/${sheetProjectId}`, { method: 'PATCH', body: JSON.stringify({ health: b.dataset.value }) }));
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

$('sheet-checkin').addEventListener('click', async () => {
  if (!sheetProjectId) return;
  try {
    replaceProject(await api(`/projects/${sheetProjectId}/checkin`, { method: 'POST' }));
    showToast('Checked in.');
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

$('sheet-edit').addEventListener('click', () => {
  editingProjectId = sheetProjectId;
  closeSheet();
});
$('sheet-close').addEventListener('click', closeSheet);
$('project-sheet').addEventListener('click', (e) => { if (e.target === $('project-sheet')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('project-sheet').hidden) closeSheet(); });
window.addEventListener('hashchange', () => { if (!$('project-sheet').hidden) closeSheet(); });

// ---------- Manage projects (#projects) ----------

async function showProjectsManage() {
  setStatus($('project-status'), '');
  renderManage();
  try {
    projects = await api('/projects');
  } catch (err) {
    return showError(err);
  }
  if (editingProjectId && !projects.some((p) => p.id === editingProjectId)) editingProjectId = null;
  renderManage();
}

function renderManage() {
  renderProjectForm();
  renderProjectList();
  renderTeam();
}

// The form adds a project, or edits the one picked from the list.
function renderProjectForm() {
  const form = $('project-form');
  const f = form.elements;
  const project = projects.find((p) => p.id === editingProjectId);
  $('project-form-title').textContent = project ? 'Edit project' : 'Add a project';
  $('project-save').textContent = project ? 'Save' : 'Add project';
  $('project-cancel').hidden = !project;

  f.name.value = project?.name ?? '';
  const categories = [...settings.workCategories];
  if (project && !categories.includes(project.category)) categories.push(project.category);
  f.category.replaceChildren(new Option('Choose a category…', ''), ...categories.map((c) => new Option(shortName(c), c)));
  f.category.value = project?.category ?? '';
  f.targetDate.value = project?.targetDate ?? '';
  form.dataset.size = project?.size ?? 'medium';
  form.dataset.health = project?.health ?? 'on_track';
  form.picked = project ? [...project.people] : ['You'];
  renderChoices();
  renderPeoplePicker();
}

function renderChoices() {
  const form = $('project-form');
  for (const group of form.querySelectorAll('.project-choice'))
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === form.dataset[group.dataset.name]));
}

function renderPeoplePicker() {
  const form = $('project-form');
  const names = teamMembers();
  for (const p of form.picked) if (!names.some((n) => sameName(n, p))) names.push(p);
  form.querySelector('.project-people').replaceChildren(...names.map((name) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = name;
    chip.setAttribute('aria-pressed', String(form.picked.some((p) => sameName(p, name))));
    chip.addEventListener('click', () => {
      form.picked = form.picked.some((p) => sameName(p, name)) ? form.picked.filter((p) => !sameName(p, name)) : [...form.picked, name];
      renderPeoplePicker();
    });
    return chip;
  }));
}

for (const group of $('project-form').querySelectorAll('.project-choice')) {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('project-form').dataset[group.dataset.name] = b.dataset.value;
    renderChoices();
  });
}

$('project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = form.elements;
  const status = $('project-status');
  const body = {
    name: f.name.value.trim(),
    category: f.category.value,
    people: form.picked,
    size: form.dataset.size,
    health: form.dataset.health,
    targetDate: f.targetDate.value || null,
  };
  if (!body.name) return setStatus(status, 'Give the project a name.', true);
  if (!body.category) return setStatus(status, 'Choose a work category.', true);
  if (!body.people.length) return setStatus(status, "Pick who's carrying it.", true);

  const editing = editingProjectId;
  const save = $('project-save');
  save.disabled = true;
  try {
    const saved = editing
      ? await api(`/projects/${editing}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await api('/projects', { method: 'POST', body: JSON.stringify(body) });
    projects = editing ? projects.map((p) => (p.id === saved.id ? saved : p)) : [...projects, saved];
    editingProjectId = null;
    renderManage();
    setStatus(status, editing ? `Saved ${saved.name}.` : `Added ${saved.name}.`);
  } catch (err) {
    setStatus(status, err.message, true);
  } finally {
    save.disabled = false;
  }
});

$('project-cancel').addEventListener('click', () => {
  editingProjectId = null;
  setStatus($('project-status'), '');
  renderProjectForm();
});

function renderProjectList() {
  $('project-list').replaceChildren(...projects.map((project) => {
    const li = document.createElement('li');
    li.classList.toggle('is-editing', project.id === editingProjectId);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'project-list-open';
    const dot = document.createElement('span');
    dot.className = `dot ${project.health}`;
    const name = document.createElement('span');
    name.className = 'project-list-name';
    name.textContent = project.name;
    const size = document.createElement('span');
    size.className = 'project-size';
    size.textContent = SIZE_LETTER[project.size];
    open.append(dot, name, size);
    open.setAttribute('aria-label', `Edit ${project.name}`);
    open.addEventListener('click', () => {
      editingProjectId = project.id;
      setStatus($('project-status'), '');
      renderManage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${project.name}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove ${project.name} from the board?`)) return;
      try {
        await api(`/projects/${project.id}`, { method: 'DELETE' });
        projects = projects.filter((p) => p.id !== project.id);
        if (editingProjectId === project.id) editingProjectId = null;
        renderManage();
        setStatus($('project-status'), `Removed ${project.name}.`);
      } catch (err) {
        setStatus($('project-status'), err.message, true);
      }
    });
    li.append(open, remove);
    return li;
  }));
  $('project-list-empty').hidden = projects.length > 0;
}

// ---------- the team ----------

function renderTeam() {
  const team = settings.team ?? knownPeople();
  const you = document.createElement('span');
  you.className = 'chip team-chip';
  you.textContent = 'You';
  $('team-chips').replaceChildren(you, ...team.map((name) => {
    const chip = document.createElement('span');
    chip.className = 'chip team-chip';
    chip.append(name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.addEventListener('click', () => saveTeam(team.filter((t) => t !== name), `Removed ${name} from the team.`));
    chip.append(remove);
    return chip;
  }));
}

async function saveTeam(team, message) {
  try {
    settings = await api('/settings', { method: 'PUT', body: JSON.stringify({ team }) });
    renderManage();
    setStatus($('project-status'), message);
    return true;
  } catch (err) {
    setStatus($('project-status'), err.message, true);
    return false;
  }
}

$('add-team-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  const team = settings.team ?? knownPeople();
  if (sameName(name, 'You') || team.some((t) => sameName(t, name)))
    return setStatus($('project-status'), `${name} is already on the team.`, true);
  if (await saveTeam([...team, name], `Added ${name} to the team.`)) input.value = '';
});
