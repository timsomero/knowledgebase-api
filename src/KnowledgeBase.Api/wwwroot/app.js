// TFAssist web app: the Tasks screen (this file) and the workout screens (workouts.js),
// talking to the same service's API.
// When sign-in is enabled it signs in with Google Identity Services once, trades the Google ID token
// for a session cookie (POST /session), and from then on the browser sends that cookie by itself.

const $ = (id) => document.getElementById(id);

let config = { authEnabled: false, googleClientId: null };
let tasks = [];
let statusFilter = 'open';
let tagFilter = '';
let expandedId = null;
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
  for (const id of SCREENS) $(id).hidden = true;
  $('signout').hidden = true;
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

function renderTask(task) {
  const li = $('task-template').content.firstElementChild.cloneNode(true);
  li.dataset.id = task.id;
  li.classList.toggle('is-done', task.status === 'done');

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
  const parts = [];
  if (task.status === 'in_progress') parts.push(['In progress', '']);
  if (task.dueDate) parts.push([`Due ${formatDue(task.dueDate)}`, isOverdue(task) ? 'overdue' : '']);
  if (task.priority !== 'normal') parts.push([task.priority === 'high' ? 'High' : 'Low', task.priority]);
  if (task.notes) parts.push(['Notes', '']);
  if (task.photos.length) parts.push([`${task.photos.length} photo${task.photos.length > 1 ? 's' : ''}`, 'photo-count']);
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
  const visible = tasks.filter((t) =>
    (statusFilter === 'all' || (statusFilter === 'done') === (t.status === 'done')) &&
    (!tagFilter || t.tags.some((x) => x.toLowerCase() === tagFilter)));
  $('list').replaceChildren(...visible.map(renderTask));
  $('empty').hidden = visible.length > 0;
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
  let message = added.length ? `Tidied up: added ${list(added)}.`
    : after.title !== before.title ? 'Tidied up the wording.'
    : '';
  const kept = [youSet.priority && 'priority', youSet.dueDate && 'due date', youSet.tags && 'tags'].filter(Boolean);
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
  const body = {
    title: $('add-title').value,
    priority: $('add-priority').value,
    dueDate: $('add-due').value || null,
    tags: parseTags($('add-tags').value),
  };
  try {
    const task = await api('/tasks', { method: 'POST', body: JSON.stringify(body) });
    $('add').reset();
    growAddTitle();
    showError(null);
    if (config.assistant)
      tidy(task, { priority: body.priority !== 'normal', dueDate: !!body.dueDate, tags: body.tags.length > 0 });
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

$('signout').addEventListener('click', signOut);

// Pick up changes made on another device when you come back to the app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkForNewVersion();
  if (!$('app').hidden) refresh();
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
//   (none) Tasks · #workout Log Workout · #workout/config Config · #workout/<id> Edit workout
const SCREENS = ['app', 'workout', 'workout-config', 'workout-edit'];

function route() {
  if (!signedIn) return;
  const hash = location.hash;
  const screen = hash === '#workout' ? 'workout'
    : hash === '#workout/config' ? 'workout-config'
    : hash.startsWith('#workout/') ? 'workout-edit'
    : 'app';

  for (const id of SCREENS) $(id).hidden = id !== screen;
  $('title').hidden = screen !== 'app';
  $('back').hidden = screen === 'app';
  $('back').href = screen === 'workout' ? '#' : '#workout';
  $('back-label').textContent = screen === 'workout' ? 'TFAssist' : 'Log Workout';
  $('open-config').hidden = screen !== 'workout';
  $('signout').hidden = screen !== 'app' || !config.authEnabled;
  showError(null);
  window.scrollTo(0, 0);

  if (screen === 'app') refresh();
  else if (screen === 'workout') showWorkoutLog();
  else if (screen === 'workout-config') showWorkoutConfig();
  else showWorkoutEdit(hash.slice('#workout/'.length));
}

window.addEventListener('hashchange', route);

function start() {
  $('signin').hidden = true;
  signedIn = true;
  route();
}

(async function init() {
  try {
    config = await (await fetch('/config')).json();
    renderVersion();
    $('assist-hint').hidden = !config.assistant;
    if (!config.authEnabled) return start();

    if (!config.googleClientId) throw new Error('Sign-in is enabled but GOOGLE_CLIENT_ID is not set on the server.');
    // Earlier versions kept Google's token in localStorage; it is no longer used.
    try { localStorage.removeItem('kb_token'); } catch { /* storage unavailable */ }

    const session = await fetch('/session');
    if (session.ok) start();
    else showSignIn();
  } catch (err) {
    renderVersion();
    showError(err);
  }
})();
