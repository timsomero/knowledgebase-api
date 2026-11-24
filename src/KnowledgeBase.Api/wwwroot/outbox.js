// Offline changes to tasks, notes, ideas and projects. A change that can't reach the server (no connection, or the server can't be
// reached) is kept in an outbox on this device and shown straight away; the outbox sends its changes, in the
// order they were made, as soon as the server answers again (when the connection comes back, when the app
// opens, and every 30 seconds while something is waiting). While anything is waiting, new changes join the
// back of the queue so the order is kept.
//
// What goes through it:
//  - tasks: adding, editing (only the fields you changed, so an edit made elsewhere to another field is kept:
//    last change wins, field by field), ticking done, deleting, and activity; a new task is tidied up by the
//    assistant once it has synced;
//  - notes and ideas: writing, editing (the whole text), pinning, filing and deleting;
//  - projects: their details, health, notes, check-ins, activity, archiving and restoring (adding a project needs a connection).
// Anything made offline gets its id here, and the server keeps that id, so sending it twice never adds it twice.
// Photos, the leadership report, the note tidy-up and Settings still need a connection.
//
// Uses $, api, tasks, refresh, render, tidy, showToast and config from app.js.

const OUTBOX_KEY = 'kb_outbox';
let outbox = (() => {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) ?? []; } catch { return []; }
})();

function writeOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* storage unavailable or full */ }
  renderOnline();
}

// Sends the change now when it can; otherwise keeps it for later. Answers { result } with the server's answer,
// or { queued: true } when it was kept (the caller then shows it with applyPending).
async function sendOrQueue(method, path, body, { quiet = false, after = null } = {}) {
  if (!outbox.length && navigator.onLine) {
    try {
      return { result: await api(path, { method, quiet, body: body === undefined ? undefined : JSON.stringify(body) }) };
    } catch (err) {
      if (!err.offline) throw err;
    }
  }
  outbox.push({ key: crypto.randomUUID(), at: new Date().toISOString(), method, path, body, after });
  writeOutbox();
  setTimeout(flushOutbox, 3000); // the server may only be waking up
  return { queued: true };
}

// Sends a change to one item (a note, idea or project); answers { item, queued } with the item as it now stands:
// the server's answer, or, when the change was kept for later, `current` (null for a new item) with it applied.
async function saveItem(kind, method, path, body, current, opts) {
  const { result, queued } = await sendOrQueue(method, path, body, opts);
  if (!queued) return { item: result, queued: false };
  const id = current?.id ?? body.id;
  return { item: applyPending(current ? [current] : [], kind).find((x) => x.id === id) ?? null, queued: true };
}

// One note, idea or project from the server with its waiting changes applied. One made offline (not on the
// server yet) comes from the outbox; one deleted offline answers null. Falls back to `list` when offline.
async function loadItem(kind, id, list = []) {
  const withChanges = (item) => applyPending([item], kind).find((x) => x.id === id) ?? null;
  const made = applyPending([], kind).find((x) => x.id === id);
  if (made) return made;
  try {
    return withChanges(await api(`/${kind}/${id}`));
  } catch (err) {
    const kept = list.find((x) => x.id === id);
    if (kept) return withChanges(kept);
    throw err;
  }
}

const SAVED_HERE = "Saved on this device. It will sync when you're back online.";

// A list (tasks, notes, ideas or projects) with every waiting change to it applied, so the screen shows them even
// when the list just came from the server (or from the copy kept for offline) without them. Applying a change
// twice is harmless.
function applyPending(list, kind = 'tasks') {
  let result = [...list];
  for (const op of outbox) {
    const [, collection, id, part, entryId] = op.path.split('/'); // "", "tasks", id, "log", entryId
    if (collection !== kind) continue;
    if (op.method === 'POST' && !id) {
      if (!result.some((x) => x.id === op.body.id)) result = [CREATE[kind](op.body, op.at), ...result];
    } else if ((op.method === 'PATCH' || op.method === 'PUT') && !part) {
      result = result.map((x) => (x.id === id ? UPDATE[kind](x, op.body, op.at) : x));
    } else if (op.method === 'DELETE' && !part) {
      result = result.filter((x) => x.id !== id);
    } else if (op.method === 'POST' && part === 'log') {
      result = result.map((x) => (x.id !== id || x.log.some((e) => e.id === op.body.id) ? x
        : { ...x, log: [...x.log, { id: op.body.id, at: op.at, text: op.body.text, auto: false }] }));
    } else if (op.method === 'DELETE' && part === 'log') {
      result = result.map((x) => (x.id === id ? { ...x, log: x.log.filter((e) => e.id !== entryId) } : x));
    } else if (op.method === 'POST' && (part === 'archive' || part === 'restore')) {
      result = result.map((x) => (x.id === id ? { ...x, archivedAt: part === 'archive' ? op.at : null, updatedAt: op.at,
        log: [...x.log, { id: `${part}-${op.key}`, at: op.at, text: part === 'archive' ? 'Archived' : 'Restored', auto: true }] } : x));
    } else if (op.method === 'POST' && part === 'checkin') {
      result = result.map((x) => (x.id === id ? { ...x, lastCheckedIn: op.at,
        log: [...x.log, { id: `checkin-${op.key}`, at: op.at, text: 'Checked in', auto: true }] } : x));
    }
  }
  return result;
}

// What each kind looks like when made offline, as the server would answer it.
const CREATE = {
  tasks: (b, at) => ({
    id: b.id, title: b.title.trim(), notes: null, status: 'todo', priority: b.priority ?? 'normal',
    dueDate: b.dueDate ?? null, tags: b.tags ?? [], delegatedTo: b.delegatedTo ?? null,
    area: b.area ?? 'personal', category: b.category ?? null,
    createdAt: at, updatedAt: at, completedAt: null, photos: [], log: [],
  }),
  notes: (b, at) => ({
    id: b.id, text: b.text.trimEnd(), html: b.html ?? null, folder: b.folder || null, pinned: !!b.pinned,
    photos: [], createdAt: at, updatedAt: at, log: b.log ?? null,
  }),
  ideas: (b, at) => ({ id: b.id, title: ideaTitle(b), text: (b.text ?? '').trimEnd(), createdAt: at, updatedAt: at }),
};

// How a waiting edit changes each kind (tasks and projects: only the fields sent; notes and ideas: the whole text).
const UPDATE = {
  tasks: (t, changes, at) => {
    const next = { ...t, ...changes, updatedAt: at };
    if (changes.status) next.completedAt = changes.status === 'done' ? (t.completedAt ?? at) : null;
    if (changes.area === 'personal') next.category = null;
    return next;
  },
  notes: (n, b, at) => ({ ...n, text: b.text.trimEnd(), html: b.html ?? null, folder: b.folder || null, pinned: b.pinned ?? n.pinned, log: b.log ?? null, updatedAt: at }),
  ideas: (i, b, at) => ({ ...i, title: ideaTitle(b), text: (b.text ?? '').trimEnd(), updatedAt: at }),
  projects: (p, changes, at) => ({ ...p, ...changes, updatedAt: at }),
};

// As the server does: the title given, else the first six words of the text.
function ideaTitle(b) {
  if (b.title?.trim()) return b.title.trim();
  const words = (b.text ?? '').split(/\s+/).filter(Boolean);
  const title = words.slice(0, 6).join(' ').replace(/[.,;:!?-]+$/, '');
  return title ? title[0].toUpperCase() + title.slice(1) + (words.length > 6 ? '…' : '') : '';
}

let flushing = false;

// Sends the waiting changes in order. Stops at the first one the server can't take yet (no connection, or the
// server failing); drops one it refuses for good (say, editing a task deleted on another device) and says so.
async function flushOutbox() {
  if (flushing || !outbox.length || !navigator.onLine) return;
  flushing = true;
  renderOnline();
  let sent = 0;
  let dropped = 0;
  const toTidy = [];
  try {
    while (outbox.length) {
      const op = outbox[0];
      let res;
      try {
        res = await fetch(op.path, {
          method: op.method,
          headers: op.body === undefined ? {} : { 'Content-Type': 'application/json' },
          body: op.body === undefined ? undefined : JSON.stringify(op.body),
        });
      } catch {
        break; // still can't reach the server
      }
      if (res.status === 401 || res.status === 403 || res.status >= 500) break; // after signing in, or later
      if (res.ok || (res.status === 404 && op.method === 'DELETE')) {
        sent++;
        if (op.after?.tidy) toTidy.push(op.after.tidy);
      } else {
        dropped++;
      }
      outbox.shift();
      writeOutbox();
    }
  } finally {
    flushing = false;
    renderOnline();
  }
  if (!sent && !dropped) return;
  if (dropped) showToast(`${dropped} change${dropped > 1 ? 's' : ''} couldn't be synced (it may have been deleted on another device).`, 'warn');
  else showToast(`Synced ${sent} change${sent > 1 ? 's' : ''} made offline.`);
  await refresh();
  // Notes, Ideas and Projects reload what they show (notes.js, ideas.js, projects.js).
  window.dispatchEvent(new Event('outbox-synced'));
  for (const { id, youSet } of toTidy) {
    const task = tasks.find((t) => t.id === id);
    if (task && config.assistant) tidy(task, youSet);
  }
}

// Signing out on purpose: changes not yet synced are lost, so ask first.
function confirmDropOutbox() {
  if (!outbox.length) return true;
  if (!confirm(`${outbox.length} change${outbox.length > 1 ? 's' : ''} made offline haven't synced yet and will be lost. Sign out anyway?`)) return false;
  outbox = [];
  writeOutbox();
  return true;
}

renderOnline(); // the bar shows what is still waiting from last time
window.addEventListener('online', flushOutbox);
setInterval(flushOutbox, 30 * 1000);
