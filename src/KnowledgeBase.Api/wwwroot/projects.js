// Work mode's Projects board: a tile per long-running project, the project's own page (#project/<id>)
// with notes and an activity log, and Manage projects (#projects).
// Uses $, api, showError, showToast, settings and shortName from app.js, and setStatus from workouts.js.

let projects = [];
let editingProjectId = null; // the project in Manage's form, or null to add one
let pageProjectId = null;    // the project its page shows

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

  // A full-width tile has room for the note beside the health; a half-width one puts it on its own line.
  const note = document.createElement('span');
  note.className = 'project-note';
  note.textContent = tileNote(project);
  const bottom = document.createElement('span');
  bottom.className = 'project-row';
  bottom.append(healthBadge(project.health, project.health === 'needs_attention' ? 'Attention' : HEALTH_NAME[project.health]));
  if (project.size === 'large') bottom.append(note);
  else if (note.textContent) {
    note.classList.add('own-line');
    top.append(note);
  }

  tile.append(top, bottom);
  return tile;
}

// ---------- a project's page (#project/<id>) ----------

async function showProjectPage(id) {
  pageProjectId = id;
  $('page-notes-status').textContent = '';
  renderProjectPage();
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

// `fresh` also refills the notes box; otherwise it is left alone so typing isn't interrupted.
function renderProjectPage(fresh = false) {
  const project = projects.find((p) => p.id === pageProjectId);
  $('project-page').classList.toggle('is-loading', !project);
  if (!project) return;
  $('page-title').textContent = project.name;
  $('page-category').textContent = project.category;
  $('page-target').textContent = project.targetDate ? `Target ${formatTarget(project.targetDate)}` : '';

  const days = daysSince(project.lastCheckedIn);
  $('page-checked').textContent = days === 0 ? 'Checked in today' : days === 1 ? 'Last checked in yesterday' : `Last checked in ${days} days ago`;
  $('page-checked').classList.toggle('is-stale', isStale(project));
  for (const b of $('page-health').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === project.health));
  if (fresh) $('page-notes').value = project.notes ?? '';

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

$('page-edit').addEventListener('click', () => {
  editingProjectId = pageProjectId;
  location.hash = '#projects';
});

// Notes save by themselves a moment after you stop typing, and when you leave the box.
let notesTimer = null;
async function saveNotes() {
  clearTimeout(notesTimer);
  const project = projects.find((p) => p.id === pageProjectId);
  const notes = $('page-notes').value;
  if (!project || (project.notes ?? '') === notes.trimEnd()) return;
  $('page-notes-status').textContent = 'Saving…';
  try {
    replaceProject(await api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes || null }) }));
    $('page-notes-status').textContent = 'Saved';
  } catch (err) {
    $('page-notes-status').textContent = `Not saved: ${err.message}`;
  }
}
$('page-notes').addEventListener('input', () => {
  clearTimeout(notesTimer);
  $('page-notes-status').textContent = '';
  notesTimer = setTimeout(saveNotes, 1000);
});
$('page-notes').addEventListener('blur', saveNotes);

$('log-form').addEventListener('submit', async (e) => {
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

// ---------- Manage projects (#projects) ----------

async function showProjectsManage() {
  setStatus($('project-status'), '');
  renderManage();
  try {
    await loadProjects();
  } catch (err) {
    return showError(err);
  }
  if (editingProjectId && !projects.some((p) => p.id === editingProjectId)) editingProjectId = null;
  renderManage();
}

function renderManage() {
  renderProjectForm();
  renderProjectList();
}

// The form adds a project, or edits the one picked from the list (or from a project's page).
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
  renderChoices();
}

function renderChoices() {
  const form = $('project-form');
  for (const group of form.querySelectorAll('.project-choice'))
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === form.dataset[group.dataset.name]));
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
    size: form.dataset.size,
    health: form.dataset.health,
    targetDate: f.targetDate.value || null,
  };
  if (!body.name) return setStatus(status, 'Give the project a name.', true);
  if (!body.category) return setStatus(status, 'Choose a work category.', true);

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
    open.append(dot, name);
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
      if (!confirm(`Remove ${project.name} from the board? Its notes and activity go with it.`)) return;
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
