// Offline changes to tasks. A change that can't reach the server (no connection, or the server can't be
// reached) is kept in an outbox on this device and shown straight away; the outbox sends its changes, in the
// order they were made, as soon as the server answers again (when the connection comes back, when the app
// opens, and every 30 seconds while something is waiting). While anything is waiting, new changes join the
// back of the queue so the order is kept.
//
// What goes through it: adding a task, editing it (only the fields you changed, so an edit made elsewhere to
// another field is kept: last change wins, field by field), ticking it done, deleting it, and adding or
// deleting activity. A task or activity line made offline gets its id here, and the server keeps that id,
// so sending it twice never adds it twice. A new task is tidied up by the assistant once it has synced.
// Photos still need a connection.
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

// The task list with every waiting change applied, so the screen shows them even when the list just came
// from the server (or from the copy kept for offline) without them. Applying a change twice is harmless.
function applyPending(list) {
  let result = [...list];
  for (const op of outbox) {
    const [, , id, part, entryId] = op.path.split('/'); // "", "tasks", id, "log", entryId
    if (op.method === 'POST' && op.path === '/tasks') {
      if (!result.some((t) => t.id === op.body.id)) result = [localTask(op.body, op.at), ...result];
    } else if (op.method === 'PATCH' && !part) {
      result = result.map((t) => (t.id === id ? patched(t, op.body, op.at) : t));
    } else if (op.method === 'DELETE' && !part) {
      result = result.filter((t) => t.id !== id);
    } else if (op.method === 'POST' && part === 'log') {
      result = result.map((t) => (t.id !== id || t.log.some((e) => e.id === op.body.id) ? t
        : { ...t, log: [...t.log, { id: op.body.id, at: op.at, text: op.body.text }] }));
    } else if (op.method === 'DELETE' && part === 'log') {
      result = result.map((t) => (t.id === id ? { ...t, log: t.log.filter((e) => e.id !== entryId) } : t));
    }
  }
  return result;
}

// A task added offline, as the server would answer it.
function localTask(body, at) {
  return {
    id: body.id, title: body.title.trim(), notes: null, status: 'todo', priority: body.priority ?? 'normal',
    dueDate: body.dueDate ?? null, tags: body.tags ?? [], delegatedTo: body.delegatedTo ?? null,
    area: body.area ?? 'personal', category: body.category ?? null,
    createdAt: at, updatedAt: at, completedAt: null, photos: [], log: [],
  };
}

function patched(task, changes, at) {
  const next = { ...task, ...changes, updatedAt: at };
  if (changes.status) next.completedAt = changes.status === 'done' ? (task.completedAt ?? at) : null;
  if (changes.area === 'personal') next.category = null;
  return next;
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
  if (dropped) showToast(`${dropped} change${dropped > 1 ? 's' : ''} couldn't be synced (the task may have been deleted on another device).`, 'warn');
  else showToast(`Synced ${sent} change${sent > 1 ? 's' : ''} made offline.`);
  await refresh();
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

window.addEventListener('online', flushOutbox);
setInterval(flushOutbox, 30 * 1000);
