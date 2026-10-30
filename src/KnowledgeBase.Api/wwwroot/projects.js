// The Projects board (Projects in the top switch): a tile per long-running work project, and each
// project's page (#project/<id>, or #project/new to add one) holding everything about it: its details,
// edited in place, check-in, health, notes and the activity log.
// Uses $, api, showError, showToast, settings and shortName from app.js, and setStatus from workouts.js.

let projects = [];
let pageProjectId = null; // the project its page shows; null while adding one

const HEALTH_NAME = { on_track: 'On track', needs_attention: 'Needs attention', blocked: 'Blocked' };
// A project not checked in for this many days fades on the board.
const STALE_DAYS = 14;

const daysSince = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);
const isStale = (project) => daysSince(project.lastCheckedIn) >= STALE_DAYS;

function formatTarget(date, withDay = true) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, withDay ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', year: 'numeric' });
}

// "Today 9:40 AM", "Yesterday 4:05 PM", or "Oct 11" (with the year when it isn't this year).
function formatWhen(iso) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function healthBadge(health, label = HEALTH_NAME[health]) {
  const span = document.createElement('span');
  span.className = `health ${health}`;
  const dot = document.createElement('span');
  dot.className = `dot ${health}`;
  span.append(dot, label);
  return span;
}

async function loadProjects() {
  projects = await api('/projects');
}

// ---------- the board ----------

async function showProjectsBoard() {
  renderBoard();
  try {
    await loadProjects();
    renderBoard();
  } catch (err) {
    showError(err);
  }
}

function renderBoard() {
  // Blocked first, then the ones needing attention or not checked in lately, then the rest; bigger first.
  const rank = (p) => (p.health === 'blocked' ? 0 : p.health === 'needs_attention' || isStale(p) ? 1 : 2);
  const order = { large: 0, medium: 1, small: 2 };
  const sorted = [...projects].sort((a, b) => rank(a) - rank(b) || order[a.size] - order[b.size] || a.name.localeCompare(b.name));
  $('project-tiles').replaceChildren(...sorted.map(renderTile));
  $('projects-count').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  $('no-projects').hidden = projects.length > 0;
}

// The tile's one extra line: not checked in lately, else the target date, else when you last wrote in its log.
function tileNote(project) {
  if (isStale(project)) return `Not checked in ${daysSince(project.lastCheckedIn)} days`;
  if (project.targetDate) return `Target ${formatTarget(project.targetDate, false)}`;
  const last = project.log.filter((e) => !e.auto).at(-1);
  if (!last) return '';
  const days = daysSince(last.at);
  return `Last note ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`;
}

function renderTile(project) {
  const tile = document.createElement('a');
  tile.href = `#project/${project.id}`;
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

  // Every tile is half the width of the board, so the note gets its own line under the category.
  const note = document.createElement('span');
  note.className = 'project-note own-line';
  note.textContent = tileNote(project);
  if (note.textContent) top.append(note);
  const bottom = document.createElement('span');
  bottom.className = 'project-row';
  bottom.append(healthBadge(project.health, project.health === 'needs_attention' ? 'Attention' : HEALTH_NAME[project.health]));

  tile.append(top, bottom);
  return tile;
}

// ---------- a project's page (#project/<id>, #project/new) ----------

async function showProjectPage(id) {
  const adding = id === 'new';
  pageProjectId = adding ? null : id;
  $('page-notes-status').textContent = '';
  setStatus($('page-status'), '');
  $('project-page').classList.toggle('is-new', adding);
  $('page-create').hidden = !adding;
  $('page-existing').hidden = adding;
  if (adding) {
    fillDetails(null);
    $('project-details').elements.name.focus();
    return;
  }
  renderProjectPage(true);
  try {
    await loadProjects();
  } catch (err) {
    return showError(err);
  }
  if (!projects.some((p) => p.id === id)) {
    showError(new Error('That project was removed.'));
    return;
  }
  renderProjectPage(true);
}

// The name, category, size and target date at the top of the page.
function fillDetails(project) {
  const f = $('project-details').elements;
  f.name.value = project?.name ?? '';
  const categories = [...settings.workCategories];
  if (project && !categories.includes(project.category)) categories.push(project.category);
  f.category.replaceChildren(new Option('Choose…', ''), ...categories.map((c) => new Option(shortName(c), c)));
  f.category.value = project?.category ?? '';
  f.size.value = project?.size ?? 'medium';
  f.targetDate.value = project?.targetDate ?? '';
}

// `fresh` also refills the fields you type in; otherwise they are left alone so typing isn't interrupted.
function renderProjectPage(fresh = false) {
  const project = projects.find((p) => p.id === pageProjectId);
  $('project-page').classList.toggle('is-loading', !project);
  if (!project) return;
  if (fresh) {
    fillDetails(project);
    $('page-notes').value = project.notes ?? '';
  }

  const days = daysSince(project.lastCheckedIn);
  $('page-checked').textContent = days === 0 ? 'Checked in today' : days === 1 ? 'Last checked in yesterday' : `Last checked in ${days} days ago`;
  $('page-checked').classList.toggle('is-stale', isStale(project));
  for (const b of $('page-health').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === project.health));

  $('activity-log').replaceChildren(...[...project.log].reverse().map((entry) => {
    const li = document.createElement('li');
    li.classList.toggle('auto', entry.auto);
    const when = document.createElement('span');
    when.className = 'log-when';
    when.textContent = formatWhen(entry.at);
    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = entry.text;
    li.append(when, text);
    if (!entry.auto) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'log-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Delete this entry');
      remove.addEventListener('click', async () => {
        if (!confirm('Delete this entry from the log?')) return;
        try {
          replaceProject(await api(`/projects/${project.id}/log/${entry.id}`, { method: 'DELETE' }));
        } catch (err) {
          showToast(err.message, 'warn');
        }
      });
      li.append(remove);
    }
    return li;
  }));
}

function replaceProject(updated) {
  projects = projects.map((p) => (p.id === updated.id ? updated : p));
  if (pageProjectId === updated.id) renderProjectPage();
}

// An existing project's details save as soon as one changes (the name when you leave the box).
// False when it couldn't be saved.
async function saveDetail(field, value) {
  const project = projects.find((p) => p.id === pageProjectId);
  if (!project || (project[field] ?? '') === (value ?? '')) return true;
  const status = $('page-status');
  if (field === 'name' && !value) {
    $('project-details').elements.name.value = project.name;
    setStatus(status, 'A project needs a name.', true);
    return false;
  }
  try {
    replaceProject(await api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) }));
    setStatus(status, 'Saved.');
    return true;
  } catch (err) {
    setStatus(status, err.message, true);
    return false;
  }
}

{
  const f = $('project-details').elements;
  f.name.addEventListener('input', () => setStatus($('page-status'), ''));
  f.name.addEventListener('change', () => saveDetail('name', f.name.value.trim()));
  f.category.addEventListener('change', () => saveDetail('category', f.category.value));
  f.size.addEventListener('change', () => saveDetail('size', f.size.value));
  f.targetDate.addEventListener('change', () => saveDetail('targetDate', f.targetDate.value || null));
}

// Enter in the name box: adds a new project, or just finishes editing an existing one's name.
$('project-details').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  if (pageProjectId) return f.name.blur();
  const status = $('page-status');
  const body = { name: f.name.value.trim(), category: f.category.value, size: f.size.value, targetDate: f.targetDate.value || null };
  if (!body.name) return setStatus(status, 'Give the project a name.', true);
  if (!body.category) return setStatus(status, 'Choose a work category.', true);
  const create = $('page-create');
  create.disabled = true;
  try {
    const created = await api('/projects', { method: 'POST', body: JSON.stringify(body) });
    projects = [...projects, created];
    // Replace #project/new, so Back goes to the board rather than to a blank form.
    location.replace(`#project/${created.id}`);
  } catch (err) {
    setStatus(status, err.message, true);
  } finally {
    create.disabled = false;
  }
});

$('page-health').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !pageProjectId || b.getAttribute('aria-checked') === 'true') return;
  try {
    replaceProject(await api(`/projects/${pageProjectId}`, { method: 'PATCH', body: JSON.stringify({ health: b.dataset.value }) }));
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

$('page-checkin').addEventListener('click', async () => {
  if (!pageProjectId) return;
  try {
    replaceProject(await api(`/projects/${pageProjectId}/checkin`, { method: 'POST' }));
    showToast('Checked in.');
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

$('page-delete').addEventListener('click', async () => {
  const project = projects.find((p) => p.id === pageProjectId);
  if (!project || !confirm(`Delete ${project.name}? Its notes and activity go with it.`)) return;
  try {
    await api(`/projects/${project.id}`, { method: 'DELETE' });
    projects = projects.filter((p) => p.id !== project.id);
    location.hash = '#';
    showToast(`Deleted ${project.name}.`);
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

// Notes save by themselves a moment after you stop typing, and when you leave the box.
// False when they couldn't be saved.
let notesTimer = null;
async function saveNotes() {
  clearTimeout(notesTimer);
  const project = projects.find((p) => p.id === pageProjectId);
  const notes = $('page-notes').value;
  if (!project || (project.notes ?? '') === notes.trimEnd()) return true;
  $('page-notes-status').textContent = 'Saving…';
  try {
    replaceProject(await api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes || null }) }));
    $('page-notes-status').textContent = 'Saved';
    return true;
  } catch (err) {
    $('page-notes-status').textContent = `Not saved: ${err.message}`;
    return false;
  }
}
$('page-notes').addEventListener('input', () => {
  clearTimeout(notesTimer);
  $('page-notes-status').textContent = '';
  notesTimer = setTimeout(saveNotes, 1000);
});
$('page-notes').addEventListener('blur', saveNotes);

$('activity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim();
  if (!text || !pageProjectId) return;
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    replaceProject(await api(`/projects/${pageProjectId}/log`, { method: 'POST', body: JSON.stringify({ text }) }));
    input.value = '';
  } catch (err) {
    showToast(err.message, 'warn');
  } finally {
    button.disabled = false;
  }
});

// Done: saves whatever isn't saved yet (a name or notes still being typed, text left in the Activity box)
// and goes back to the board. Anything that fails to save keeps you on the page with its message.
$('page-done').addEventListener('click', async () => {
  if (!pageProjectId) return;
  const done = $('page-done');
  done.disabled = true;
  try {
    const saved = await saveDetail('name', $('project-details').elements.name.value.trim()) && await saveNotes();
    if (!saved) return;
    const entry = $('activity-form').elements.text;
    const text = entry.value.trim();
    if (text) {
      replaceProject(await api(`/projects/${pageProjectId}/log`, { method: 'POST', body: JSON.stringify({ text }) }));
      entry.value = '';
    }
    location.hash = '#';
  } catch (err) {
    showToast(err.message, 'warn');
  } finally {
    done.disabled = false;
  }
});
