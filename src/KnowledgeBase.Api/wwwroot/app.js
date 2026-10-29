// TFAssist web app: the Tasks screen (this file) and the workout screens (workouts.js),
// talking to the same service's API.
// When sign-in is enabled it signs in with Google Identity Services once, trades the Google ID token
// for a session cookie (POST /session), and from then on the browser sends that cookie by itself.

const $ = (id) => document.getElementById(id);

let config = { authEnabled: false, googleClientId: null };
let tasks = [];
let settings = { workCategories: [] }; // from the Settings screen (settings.js)
let statusFilter = 'open';
let tagFilter = '';
let personFilter = ''; // '' anyone, MINE not delegated, else a person's name in lower case
const MINE = ' mine';
let categoryFilter = ''; // Work mode: '' all, NONE uncategorized, else a category in lower case
const NONE = ' none';let expandedId = null;
let signedIn = false;
// Tasks just added that the assistant is still tidying up.
const tidying = new Set();

// ---------- sign-in ----------

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
}

let googleReady = null;

// Google's script is only needed when there is no valid session yet.
function initGoogle() {
  googleReady ??= loadGoogleScript().then(() =>
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: onSignedIn,
      auto_select: true,
    }));
  return googleReady;
}

async function showSignIn() {
  signedIn = false;
  clearSavedTasks();
  for (const id of SCREENS) $(id).hidden = true;
  $('signout').hidden = true;
  $('open-settings').hidden = true;
  $('signin').hidden = false;
  try {
    await initGoogle();
  } catch (err) {
    return showError(err);
  }
  google.accounts.id.renderButton($('google-button'), { theme: 'outline', size: 'large' });
  // auto_select re-signs in silently once you have signed in before.
  google.accounts.id.prompt();
}

async function onSignedIn(response) {
  const res = await fetch('/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${response.credential}` },
  });
  if (!res.ok) {
    return showError(new Error(res.status === 403 ? 'This Google account is not allowed.' : 'Sign-in failed.'));
  }
  showError(null);
  start();
}

async function signOut() {
  await fetch('/session', { method: 'DELETE' }).catch(() => {});
  await initGoogle().then(() => google.accounts.id.disableAutoSelect()).catch(() => {});
  showSignIn();
}

// ---------- API ----------

async function api(path, options = {}) {
  // JSON bodies are strings; a FormData body (photo upload) sets its own content type.
  const headers = typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    if (config.authEnabled) showSignIn();
    throw new Error(res.status === 403 ? 'This Google account is not allowed.' : 'Please sign in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status}).`);
  }
  return res.status === 204 ? null : res.json();
}

function showError(err) {
  $('error').textContent = err ? err.message : '';
  $('error').hidden = !err;
}

async function refresh() {
  try {
    tasks = await api('/tasks');
    showError(null);
    render();
  } catch (err) {
    showError(err);
  }
}

async function updateTask(id, changes) {
  try {
    const updated = await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    tasks = tasks.map((t) => (t.id === id ? updated : t));
    showError(null);
    render();
  } catch (err) {
    showError(err);
  }
}

// ---------- Personal / Work / Work Projects ----------

// The switch at the top of the Tasks screen. Each device remembers its own choice: the work computer can
// stay on Work while the phone stays Personal. Personal and Work are two separate task lists (work tasks
// have a category from Settings); Projects is the projects board (projects.js).
const MODE_KEY = 'kb_mode';
const MODES = ['personal', 'work', 'projects'];
let mode = (() => {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    // Earlier builds kept Projects as a tab under Work.
    if (saved === 'work' && localStorage.getItem('kb_work_view') === 'projects') return 'projects';
    return MODES.includes(saved) ? saved : 'personal';
  } catch { return 'personal'; }
})();
const showingProjects = () => mode === 'projects';

function setMode(value) {
  mode = value;
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.removeItem('kb_work_view');
  } catch { /* storage unavailable */ }
  expandedId = null;
  renderMode();
  render();
  if (showingProjects()) showProjectsBoard();
}

// The parts of the Tasks screen that differ between the modes.
function renderMode() {
  const work = mode === 'work';
  for (const b of $('mode-switch').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('app').classList.toggle('is-work', work);
  $('log-workout').hidden = work;
  $('add-title').placeholder = work ? 'Add a work task…' : 'Add a task…';
  $('tasks-view').hidden = showingProjects();
  $('projects-view').hidden = !showingProjects();
  if (showingProjects()) renderBoard();
  renderAddCategory();
}

// Work mode asks for a category before a task can be added; it starts empty after every add.
function renderAddCategory() {
  const select = $('add-task-category');
  const picked = select.value;
  select.replaceChildren(new Option('Choose a category…', ''), ...settings.workCategories.map((c) => new Option(shortName(c), c)));
  select.value = settings.workCategories.includes(picked) ? picked : '';
  select.hidden = mode !== 'work';
  updateAddButton();
}

function updateAddButton() {
  const missing = mode === 'work' && !$('add-task-category').value;
  $('add').querySelector('button[type=submit]').disabled = missing;
  $('add-task-category').classList.toggle('is-empty', missing);
  $('category-hint').hidden = !missing;
}

// A phone's dropdown wraps long names onto several lines, so dropdowns show them cut short.
const shortName = (name) => (name.length > 15 ? `${name.slice(0, 14).trimEnd()}…` : name);

// Tasks added in the last hour are highlighted and marked NEW, so one the assistant reworded is easy to find.
const NEW_FOR = 60 * 60 * 1000;
const isNew = (task) => Date.now() - new Date(task.createdAt) < NEW_FOR;

// ---------- rendering ----------

const parseTags = (s) => s.split(',').map((t) => t.trim()).filter(Boolean);

function formatDue(due) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (due === todayStr) return 'Today';
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    year: y === today.getFullYear() ? undefined : 'numeric',
  });
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'done') return false;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const today = new Date();
  return new Date(y, m - 1, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function renderTagFilter() {
  const tags = [...new Set(tasks.flatMap((t) => t.tags.map((x) => x.toLowerCase())))].sort();
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
  const select = $('tag-filter');
  select.replaceChildren(new Option('All tags', ''), ...tags.map((t) => new Option(`#${t}`, t)));
  select.value = tagFilter;
}

// Shown once any task is delegated: Anyone, Only mine, then each person.
function renderPersonFilter() {
  const people = knownPeople();
  const keys = people.map((p) => p.toLowerCase());
  if (personFilter && personFilter !== MINE && !keys.includes(personFilter)) personFilter = '';
  const select = $('person-filter');
  select.hidden = people.length === 0 && !personFilter;
  select.replaceChildren(
    new Option('Anyone', ''),
    new Option('Only mine (not delegated)', MINE),
    ...people.map((p) => new Option(`→ ${p}`, p.toLowerCase())));
  select.value = personFilter;
}

function matchesPerson(task) {
  if (!personFilter) return true;
  if (personFilter === MINE) return !task.delegatedTo;
  return task.delegatedTo?.toLowerCase() === personFilter;
}

// Work mode only: All categories, each category in Settings or on a work task, and Uncategorized
// when a work task has none.
function renderCategoryFilter() {
  const select = $('category-filter');
  select.hidden = mode !== 'work';
  if (mode !== 'work') return;
  const work = tasks.filter((t) => t.area === 'work');
  const names = [...settings.workCategories];
  for (const c of work.map((t) => t.category).filter(Boolean))
    if (!names.some((n) => n.toLowerCase() === c.toLowerCase())) names.push(c);
  const keys = names.map((n) => n.toLowerCase());
  const uncategorized = work.some((t) => !t.category);
  if (categoryFilter && !keys.includes(categoryFilter) && !(categoryFilter === NONE && uncategorized)) categoryFilter = '';
  select.replaceChildren(
    new Option('All categories', ''),
    ...names.map((n) => new Option(shortName(n), n.toLowerCase())),
    ...(uncategorized ? [new Option('Uncategorized', NONE)] : []));
  select.value = categoryFilter;
}

function matchesCategory(task) {
  if (mode !== 'work' || !categoryFilter) return true;
  if (categoryFilter === NONE) return !task.category;
  return task.category?.toLowerCase() === categoryFilter;
}

// The edit form's Category buttons, one tap each. A work task shows the work categories (its own picked)
// and "Move to Personal"; a personal task shows "Move to Work…", which opens the categories. The choice
// is kept in a hidden input: '' personal, NONE work with no category yet, else the category.
function renderListField(li, task) {
  const input = li.querySelector('.edit').elements.list;
  const chips = li.querySelector('.list-chips');
  li.querySelector('.list-field .tags-title').textContent = task.area === 'work' ? 'Category' : 'List';
  input.value = task.area === 'work' ? task.category ?? NONE : '';
  let open = task.area === 'work';

  const chip = (text, onClick, checked = null) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    b.title = text;
    if (checked !== null) {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(checked));
    }
    b.addEventListener('click', onClick);
    return b;
  };
  const pick = (value) => () => {
    input.value = value;
    draw();
  };

  function draw() {
    if (!open) {
      const move = chip('Move to Work…', () => {
        open = true;
        draw();
      });
      move.classList.add('to-list');
      return chips.replaceChildren(move);
    }
    const names = [...settings.workCategories];
    if (task.category && !names.includes(task.category)) names.push(task.category);
    const personal = chip(task.area === 'work' ? '→ Personal' : 'Keep Personal', pick(''), input.value === '');
    personal.classList.add('to-list');
    chips.replaceChildren(...names.map((n) => chip(n, pick(n), input.value === n)), personal);
  }
  draw();
}

function listChanges(value) {
  if (!value) return { area: 'personal', category: null };
  return { area: 'work', category: value === NONE ? null : value };
}

function renderTask(task) {
  const li = $('task-template').content.firstElementChild.cloneNode(true);
  li.dataset.id = task.id;
  li.classList.toggle('is-done', task.status === 'done');
  li.classList.toggle('is-overdue', isOverdue(task));
  li.classList.toggle('is-new', isNew(task));

  const checkbox = li.querySelector('.done');
  checkbox.checked = task.status === 'done';
  checkbox.addEventListener('change', () =>
    updateTask(task.id, { status: checkbox.checked ? 'done' : 'todo' }));

  li.querySelector('.title').textContent = task.title;
  renderMeta(li, task);
  renderPhotos(li, task);

  const form = li.querySelector('.edit');
  const f = form.elements;
  form.hidden = expandedId !== task.id;
  f.title.value = task.title;
  f.notes.value = task.notes || '';
  f.status.value = task.status;
  f.priority.value = task.priority;
  f.dueDate.value = task.dueDate || '';
  f.tags.value = task.tags.join(', ');
  attachTagPicker(f.tags);
  f.delegatedTo.value = task.delegatedTo || '';
  attachPersonPicker(f.delegatedTo);
  renderListField(li, task);

  li.querySelector('.open').addEventListener('click', () => {
    expandedId = expandedId === task.id ? null : task.id;
    render();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    expandedId = null;
    updateTask(task.id, {
      title: f.title.value,
      notes: f.notes.value || null,
      status: f.status.value,
      priority: f.priority.value,
      dueDate: f.dueDate.value || null,
      tags: parseTags(f.tags.value),
      delegatedTo: f.delegatedTo.value || null,
      ...listChanges(f.list.value),
    });
  });

  li.querySelector('.delete').addEventListener('click', async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      tasks = tasks.filter((t) => t.id !== task.id);
      showError(null);
      render();
    } catch (err) {
      showError(err);
    }
  });

  return li;
}

// The line under a task's title. Also redrawn on its own when a photo is added or removed,
// so an open edit form keeps what you have typed.
function renderMeta(li, task) {
  const meta = li.querySelector('.meta');
  meta.replaceChildren();
  li.classList.toggle('is-tidying', tidying.has(task.id));
  if (tidying.has(task.id)) {
    meta.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    meta.append('Saved · tidying up in the background');
    return;
  }
  li.classList.toggle('is-new', isNew(task));
  const parts = [];
  if (isNew(task)) parts.push(['New', 'new']);
  if (task.status === 'in_progress') parts.push(['In progress', '']);
  if (task.dueDate) parts.push([`Due ${formatDue(task.dueDate)}`, isOverdue(task) ? 'overdue' : '']);
  if (task.priority !== 'normal') parts.push([task.priority === 'high' ? 'High' : 'Low', task.priority]);
  if (task.notes) parts.push(['Notes', '']);
  if (task.delegatedTo) parts.push([`→ ${task.delegatedTo}`, 'who']);
  if (task.photos.length) parts.push([`${task.photos.length} photo${task.photos.length > 1 ? 's' : ''}`, 'photo-count']);
  if (task.area === 'work') parts.push(task.category ? [task.category, 'category'] : ['Uncategorized', 'category none']);
  for (const tag of task.tags) parts.push([`#${tag}`, '']);
  parts.forEach(([text, cls], i) => {
    if (i > 0) meta.append(' · ');
    const span = document.createElement('span');
    span.textContent = text;
    if (cls) span.className = cls;
    meta.append(span);
  });
}

function render() {
  renderTagFilter();
  renderCategoryFilter();
  renderPersonFilter();
  $('tag-filter').hidden = mode === 'work';
  const visible = tasks.filter((t) =>
    (t.area === 'work') === (mode === 'work') &&
    (statusFilter === 'all' || (statusFilter === 'done') === (t.status === 'done')) &&
    (mode === 'work' || !tagFilter || t.tags.some((x) => x.toLowerCase() === tagFilter)) &&
    matchesCategory(t) &&
    matchesPerson(t));
  $('list').replaceChildren(...visible.map(renderTask));
  $('empty').hidden = visible.length > 0;
  if (signedIn) saveTasks();
}

// ---------- saved copy on this device ----------

// The last task list is kept in the browser's local storage and shown the moment the app opens, so it
// feels instant even while the server is starting up; the server's list replaces it a moment later.
// Signing out (or a lost session) deletes it.
const SAVED_KEY = 'kb_saved_tasks';

function saveTasks() {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ config, tasks, settings })); } catch { /* storage unavailable or full */ }
}

function loadSavedTasks() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)); } catch { return null; }
}

function clearSavedTasks() {
  try { localStorage.removeItem(SAVED_KEY); } catch { /* storage unavailable */ }
}

// ---------- tidy-up ----------

// The task is already saved as typed; this asks the server to tidy it up and shows what changed.
// Nothing waits on it, so the next task can be added straight away.
async function tidy(task, youSet) {
  tidying.add(task.id);
  let result = null;
  try {
    result = await api(`/tasks/${task.id}/tidy?today=${todayString()}`, { method: 'POST' });
  } catch { /* offline or failed: the task stays as typed */ }
  tidying.delete(task.id);

  const message = result?.status === 'tidied' ? describeTidy(task, result.task, youSet) : '';
  if (!result || result.status === 'unavailable')
    showToast("Saved as typed. The assistant wasn't available, so nothing was filled in.", 'warn');
  else if (message)
    showToast(message);
  // Otherwise there was nothing to change, or you changed the task meanwhile ("skipped").

  if (!$('app').hidden) refresh();
}

function describeTidy(before, after, youSet) {
  const added = [];
  if (after.dueDate && !before.dueDate) added.push('a due date');
  if (after.priority !== before.priority) added.push('priority');
  if (after.notes && !before.notes) added.push('notes');
  for (const tag of after.tags) if (!before.tags.includes(tag)) added.push(`#${tag}`);

  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const delegated = after.delegatedTo && !before.delegatedTo ? `delegated to ${after.delegatedTo}` : '';
  let message = added.length ? `Tidied up: added ${list(added)}.${delegated ? ` Marked as ${delegated}.` : ''}`
    : delegated ? `Tidied up: marked as ${delegated}.`
    : after.title !== before.title ? 'Tidied up the wording.'
    : '';
  const kept = [youSet.priority && 'priority', youSet.dueDate && 'due date', youSet.tags && 'tags', youSet.delegatedTo && 'person'].filter(Boolean);
  if (message && kept.length) message += ` Kept your ${list(kept)}.`;
  return message;
}

let toastTimer = null;

function showToast(message, kind = '') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

// ---------- wiring ----------

$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  // Enter in the box submits even while + is greyed out.
  if (mode === 'work' && !$('add-task-category').value) return $('add-task-category').focus();
  const body = {
    title: $('add-title').value,
    priority: $('add-priority').value,
    dueDate: $('add-due').value || null,
    tags: parseTags($('add-tags').value),
    delegatedTo: $('add-delegated').value || null,
    ...(mode === 'work' ? { area: 'work', category: $('add-task-category').value } : {}),
  };
  try {
    const task = await api('/tasks', { method: 'POST', body: JSON.stringify(body) });
    $('add').reset();
    $('add-tags').tagPicker.set([]);
    $('add-delegated').personPicker.set('');
    $('add-task-category').value = '';
    updateAddButton();
    growAddTitle();
    showError(null);
    if (config.assistant)
      tidy(task, { priority: body.priority !== 'normal', dueDate: !!body.dueDate, tags: body.tags.length > 0, delegatedTo: !!body.delegatedTo });
    // Re-fetch so the new task lands in the server's sort order.
    await refresh();
    if (statusFilter === 'done') setStatusFilter('open');
  } catch (err) {
    showError(err);
  }
});

// The add box grows with what you type or dictate; Enter adds the task, Shift+Enter starts a new line.
function growAddTitle() {
  const box = $('add-title');
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
}

$('add-title').addEventListener('input', growAddTitle);
$('add-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('add').requestSubmit();
  }
});

function setStatusFilter(status) {
  statusFilter = status;
  for (const b of $('status-filter').querySelectorAll('button'))
    b.classList.toggle('active', b.dataset.status === status);
  render();
}

$('status-filter').addEventListener('click', (e) => {
  if (e.target.dataset.status) setStatusFilter(e.target.dataset.status);
});

$('tag-filter').addEventListener('change', (e) => {
  tagFilter = e.target.value;
  render();
});

$('mode-switch').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.mode !== mode) setMode(b.dataset.mode);
});

$('add-task-category').addEventListener('change', updateAddButton);

$('category-filter').addEventListener('change', (e) => {
  categoryFilter = e.target.value;
  render();
});

// The NEW marks come off an hour after a task was added; only the meta lines are redrawn, so an open
// edit form keeps what you have typed.
setInterval(() => {
  if ($('app').hidden) return;
  for (const li of $('list').children) {
    const task = tasks.find((t) => t.id === li.dataset.id);
    if (task && li.classList.contains('is-new') !== isNew(task)) renderMeta(li, task);
  }
}, 60 * 1000);

$('person-filter').addEventListener('change', (e) => {
  personFilter = e.target.value;
  render();
});

$('signout').addEventListener('click', signOut);

// Pick up changes made on another device when you come back to the app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkForNewVersion();
  if (!$('app').hidden) loadSettings().then(renderMode).then(refresh).then(() => { if (showingProjects()) showProjectsBoard(); });
  if (!$('workout').hidden) loadRecentWorkouts();
});

// ---------- version ----------

// The build this page was loaded from, stamped into index.html when the image is built.
function pageVersion() {
  const read = (name) => {
    const v = document.querySelector(`meta[name="${name}"]`)?.content ?? '';
    return v.startsWith('__') ? null : v; // not stamped: running from source
  };
  return { build: read('app-build') ?? 'dev', commit: read('app-commit') ?? 'local' };
}

// Shows "Build N · commit" in the footer, plus a reload link when the server runs a newer build.
function renderVersion() {
  const mine = pageVersion();
  const server = config.version;
  const footer = $('version');
  footer.textContent = `Build ${mine.build} · ${mine.commit}`;
  if (server && (server.build !== mine.build || server.commit !== mine.commit)) {
    const reload = document.createElement('a');
    reload.href = '';
    reload.textContent = `Build ${server.build} is available. Tap to update.`;
    reload.addEventListener('click', (e) => {
      e.preventDefault();
      location.reload();
    });
    footer.append(' · ', reload);
  }
}

async function checkForNewVersion() {
  try {
    config = await (await fetch('/config')).json();
    renderVersion();
  } catch { /* offline; try again next time */ }
}

// ---------- screens ----------

// The screen is chosen by the URL hash, so the phone's back button moves between screens:
//   (none) Tasks · #settings Settings · #project/<id> a project's page (#project/new adds one)
//   #workout Log Workout · #workout/config Config · #workout/<id> Edit workout
const SCREENS = ['app', 'settings', 'project-page', 'workout', 'workout-config', 'workout-edit'];

function route() {
  if (!signedIn) return;
  const hash = location.hash;
  const screen = hash === '#settings' ? 'settings'
    : hash.startsWith('#project/') ? 'project-page'
    : hash === '#workout' ? 'workout'
    : hash === '#workout/config' ? 'workout-config'
    : hash.startsWith('#workout/') ? 'workout-edit'
    : 'app';

  for (const id of SCREENS) $(id).hidden = id !== screen;
  $('title').hidden = screen !== 'app';
  $('back').hidden = screen === 'app';
  const backToTasks = screen === 'workout' || screen === 'settings' || screen === 'project-page';
  $('back').href = backToTasks ? '#' : '#workout';
  $('back-label').textContent = screen === 'project-page' ? 'Projects' : backToTasks ? 'TFAssist' : 'Log Workout';
  $('open-config').hidden = screen !== 'workout';
  $('open-settings').hidden = screen !== 'app';
  $('signout').hidden = screen !== 'app' || !config.authEnabled;
  showError(null);
  window.scrollTo(0, 0);

  if (screen === 'app') {
    renderMode();
    // On open, init has just fetched the tasks; no need to ask again.
    if (freshTasks) render();
    else refresh();
    freshTasks = false;
    if (showingProjects()) showProjectsBoard();
  }
  else if (screen === 'settings') showSettings();
  else if (screen === 'project-page') showProjectPage(hash.slice('#project/'.length));
  else if (screen === 'workout') showWorkoutLog();
  else if (screen === 'workout-config') showWorkoutConfig();
  else showWorkoutEdit(hash.slice('#workout/'.length));
}

window.addEventListener('hashchange', route);

let freshTasks = false;

function start(tasksLoaded = false) {
  $('signin').hidden = true;
  signedIn = true;
  freshTasks = tasksLoaded;
  route();
}

(async function init() {
  // Ask for the settings (which also say whether the session is still good) and the tasks at the
  // same time, rather than one after the other.
  const onTasksScreen = !location.hash;
  const configRequest = fetch('/config');
  const tasksRequest = onTasksScreen ? fetch('/tasks').catch(() => null) : null;
  const settingsRequest = fetch('/settings').catch(() => null);

  // The other scripts (workouts, photos, tags) load after this one.
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));

  const saved = onTasksScreen && loadSavedTasks();
  if (saved) {
    // Its build number may be old, so leave that to the server's answer.
    config = { ...saved.config, version: undefined };
    tasks = saved.tasks;
    settings = saved.settings ?? settings;
    $('assist-hint').hidden = !config.assistant;
    $('app').hidden = false;
    renderMode();
    render();
  }

  try {
    config = await (await configRequest).json();
    renderVersion();
    $('assist-hint').hidden = !config.assistant;
    // Earlier versions kept Google's token in localStorage; it is no longer used.
    try { localStorage.removeItem('kb_token'); } catch { /* storage unavailable */ }
    if (config.authEnabled && !config.googleClientId) throw new Error('Sign-in is enabled but GOOGLE_CLIENT_ID is not set on the server.');
    if (!config.signedIn) return showSignIn();

    const settingsRes = await settingsRequest;
    if (settingsRes?.ok) settings = await settingsRes.json();
    const res = await tasksRequest;
    if (res?.ok) tasks = await res.json();
    start(!!res?.ok);
  } catch (err) {
    renderVersion();
    showError(err);
  }
})();
