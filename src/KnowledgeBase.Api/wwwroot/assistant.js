// The assistant: the Ask button above the tab bar opens a sheet where you type or say what to change
// ("push my personal tasks due today to Monday", "did 45 minutes on the bike, then back and biceps").
// Claude plans the changes on the server (POST /assistant/plan) and the sheet shows them, before and after,
// to untick, Submit (POST /assistant/plans/<id>/apply) or refine with another sentence. Nothing changes
// until Submit. After it, a bar says what was done with Undo; Settings → Assistant history lists the last few.
// Uses $, api, config, formatDue, todayString, showToast and route from app.js.

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

let askPlan = null;        // the plan on screen, as the server returned it
let askUnticked = new Set(); // change ids you unticked
let askBusy = false;
let recognition = null;
let doneTimer = null;

// Screens with their own big text box, where the button would sit over what you're typing.
const NO_ASK_SCREENS = ['note', 'idea', 'report'];

function updateAskButton(screen) {
  const show = !!config.ask && signedIn && !NO_ASK_SCREENS.includes(screen);
  $('ask-open').hidden = !show;
  document.body.classList.toggle('has-ask', show);
}

// ---------- the sheet ----------

function openAsk() {
  $('ask-sheet').hidden = false;
  renderAsk();
  $('ask-input').focus();
}

function closeAsk() {
  stopListening();
  $('ask-sheet').hidden = true;
}

function resetAsk() {
  askPlan = null;
  askUnticked = new Set();
  $('ask-input').value = '';
  $('ask-status').textContent = '';
  renderAsk();
  $('ask-input').focus();
}

function renderAsk() {
  const plan = askPlan;
  // The question being asked shows below with its choices, not in the list as well.
  const said = (plan?.turns ?? []).slice(0, plan?.question ? -1 : undefined);
  $('ask-said').replaceChildren(...said.map((turn) => {
    const li = document.createElement('li');
    li.className = turn.role === 'user' ? 'ask-turn' : 'ask-turn asked';
    li.textContent = turn.role === 'user' ? `“${turn.text}”` : turn.text;
    return li;
  }));
  $('ask-reset').hidden = !plan;
  $('ask-examples').hidden = !!plan;

  const question = plan?.question;
  $('ask-question').hidden = !question;
  if (question) {
    $('ask-question-text').textContent = question;
    $('ask-choices').replaceChildren(...(plan.choices ?? []).map((choice) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ask-choice';
      b.textContent = choice;
      b.addEventListener('click', () => sendAsk(choice));
      return b;
    }));
  }

  const changes = plan?.changes ?? [];
  $('ask-result').hidden = !plan || !!question;
  if (plan && !question) {
    $('ask-summary').textContent = plan.summary || (changes.length ? 'Here is what I would change' : 'Nothing to change');
    $('ask-hint').hidden = changes.length < 2;
    $('ask-changes').replaceChildren(...changes.map(renderChange));
    updateSubmit();
  }

  $('ask-label').textContent = !plan ? 'What should I change?' : question ? 'Your answer' : 'Or refine it';
  $('ask-input').placeholder = !plan ? 'e.g. Push my personal tasks due today to Monday'
    : question ? 'e.g. the second one' : 'e.g. leave the dentist one alone';
  $('ask-input').rows = plan ? 2 : 4;
  $('ask-send').textContent = !plan ? 'Show me the changes' : question ? 'Answer' : 'Refine';
  $('ask-send').classList.toggle('secondary-outline', !!plan && !question);
  $('ask-mic').hidden = !SpeechRecognitionApi;
}

function updateSubmit() {
  const n = (askPlan?.changes ?? []).filter((c) => !askUnticked.has(c.id)).length;
  $('ask-submit').hidden = (askPlan?.changes ?? []).length === 0;
  $('ask-submit').disabled = n === 0 || askBusy;
  $('ask-submit').textContent = n === 0 ? 'Nothing ticked' : `Submit ${n} change${n === 1 ? '' : 's'}`;
}

const KIND_LABELS = {
  task_update: 'Task',
  task_create: 'New task',
  task_activity: 'Task activity',
  project_update: 'Project',
  project_archive: 'Archive project',
  project_restore: 'Restore project',
  workout_create: 'New workout',
};

const FIELD_NAMES = {
  title: 'Title', notes: 'Notes', dueDate: 'Due', status: 'Status', priority: 'Priority', area: 'List',
  category: 'Category', delegatedTo: 'Delegated to', health: 'Health', date: 'Date',
};

const VALUE_NAMES = {
  todo: 'To do', in_progress: 'In progress', done: 'Done', low: 'Low', normal: 'Normal', high: 'High',
  personal: 'Personal', work: 'Work', on_track: 'On track', needs_attention: 'Needs attention', blocked: 'Blocked',
};

function fieldValue(field, value) {
  if (value == null || value === '') return field === 'dueDate' ? 'No date' : 'None';
  if (field === 'dueDate' || field === 'date') return formatDue(value);
  return VALUE_NAMES[value] ?? value;
}

function renderChange(change) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  label.className = 'ask-change';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !askUnticked.has(change.id);
  box.addEventListener('change', () => {
    if (box.checked) askUnticked.delete(change.id);
    else askUnticked.add(change.id);
    li.classList.toggle('unticked', !box.checked);
    updateSubmit();
  });
  li.classList.toggle('unticked', !box.checked);

  const body = document.createElement('span');
  body.className = 'ask-change-body';
  const kind = document.createElement('span');
  kind.className = `ask-kind ${change.kind}`;
  const date = change.fields.find((f) => f.field === 'date')?.after;
  kind.textContent = change.kind === 'workout_create' && date ? `${KIND_LABELS[change.kind]} · ${formatDue(date)}` : KIND_LABELS[change.kind] ?? change.kind;
  const title = document.createElement('strong');
  title.textContent = change.title;
  body.append(kind, title);

  if (change.kind === 'workout_create') {
    const minutes = change.fields.find((f) => f.field === 'durationMinutes')?.after;
    const miles = change.fields.find((f) => f.field === 'distanceMiles')?.after;
    const notes = change.fields.find((f) => f.field === 'notes')?.after;
    const parts = [minutes && `${minutes} min`, miles && `${miles} mi`].filter(Boolean);
    if (parts.length) body.append(line(parts.join(' · ')));
    if (notes) body.append(line(`Notes: ${notes}`));
  } else {
    if (change.text) body.append(line(change.text, 'ask-text'));
    for (const f of change.fields) {
      const row = document.createElement('span');
      row.className = 'ask-field';
      row.append(`${FIELD_NAMES[f.field] ?? f.field}: `);
      if (change.kind === 'task_update' || change.kind === 'project_update') {
        const before = document.createElement('del');
        before.textContent = fieldValue(f.field, f.before);
        const after = document.createElement('ins');
        after.textContent = fieldValue(f.field, f.after);
        row.append(before, ' → ', after);
      } else {
        row.append(fieldValue(f.field, f.after));
      }
      body.append(row);
    }
  }

  label.append(box, body);
  li.append(label);
  return li;
}

function line(text, className = 'ask-detail') {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function setAskBusy(busy) {
  askBusy = busy;
  $('ask-loading').hidden = !busy;
  $('ask-send').disabled = busy;
  $('ask-input').disabled = busy;
  for (const b of $('ask-choices').querySelectorAll('button')) b.disabled = busy;
  updateSubmit();
}

async function sendAsk(text) {
  const message = (text ?? $('ask-input').value).trim();
  if (!message || askBusy) return;
  stopListening();
  $('ask-status').textContent = '';
  setAskBusy(true);
  try {
    const plan = await api('/assistant/plan', {
      method: 'POST',
      quiet: true,
      body: JSON.stringify({ message, planId: askPlan?.id ?? null, today: todayString() }),
    });
    // A refined plan keeps what you unticked, for changes still in it.
    const ids = new Set(plan.changes.map((c) => c.id));
    askUnticked = new Set([...askUnticked].filter((id) => ids.has(id)));
    askPlan = plan;
    $('ask-input').value = '';
  } catch (err) {
    $('ask-status').textContent = err.offline ? 'The assistant needs a connection. Try again once you are online.' : err.message;
  } finally {
    setAskBusy(false);
    renderAsk();
  }
}

async function submitAsk() {
  if (!askPlan || askBusy) return;
  const changeIds = askPlan.changes.filter((c) => !askUnticked.has(c.id)).map((c) => c.id);
  if (!changeIds.length) return;
  setAskBusy(true);
  try {
    const result = await api(`/assistant/plans/${askPlan.id}/apply`, { method: 'POST', body: JSON.stringify({ changeIds }) });
    const summary = askPlan.summary;
    askPlan = null;
    askUnticked = new Set();
    closeAsk();
    showDone(result, summary);
    route(); // show the changes on the screen you're on
  } catch (err) {
    $('ask-status').textContent = err.message;
  } finally {
    setAskBusy(false);
    renderAsk();
  }
}

// ---------- after Submit ----------

function showDone(result, summary) {
  const skipped = result.results.filter((r) => r.status === 'skipped');
  const batch = result.batch;
  if (!batch) {
    showToast(`Nothing was changed: ${skipped[0]?.reason ?? 'no changes left.'}`, 'warn');
    return;
  }
  let text = batch.lines.length === 1 ? batch.lines[0] : `Done: ${summary || `${batch.lines.length} changes`}`;
  if (skipped.length) text += `. Skipped ${skipped.length}: ${skipped[0].reason}`;
  $('ask-done-text').textContent = text;
  $('ask-undo').hidden = false;
  $('ask-undo').disabled = false;
  $('ask-undo').onclick = () => undoBatch(batch.id);
  $('ask-done').hidden = false;
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { $('ask-done').hidden = true; }, 12000);
}

async function undoBatch(id) {
  $('ask-undo').disabled = true;
  try {
    const result = await api(`/assistant/batches/${id}/undo`, { method: 'POST' });
    $('ask-done').hidden = true;
    showToast(result.skipped.length ? `Undone, except: ${result.skipped.join('; ')}` : 'Undone.', result.skipped.length ? 'warn' : '');
    route();
  } catch (err) {
    showToast(err.message, 'warn');
    $('ask-undo').disabled = false;
  }
}

// Settings → Assistant history (called from settings.js).
async function showAssistantHistory() {
  $('assistant-history-box').hidden = !config.ask;
  if (!config.ask) return;
  let batches;
  try {
    batches = await api('/assistant/batches');
  } catch {
    return;
  }
  $('assistant-history-empty').hidden = batches.length > 0;
  $('assistant-history').replaceChildren(...batches.map((batch) => {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'assistant-history-head';
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = new Date(batch.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    head.append(when);
    if (batch.undoneAt) {
      const undone = document.createElement('span');
      undone.className = 'muted';
      undone.textContent = 'Undone';
      head.append(undone);
    } else {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'secondary-outline';
      undo.textContent = 'Undo';
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        await undoBatch(batch.id);
        showAssistantHistory();
      });
      head.append(undo);
    }
    const lines = document.createElement('ul');
    lines.replaceChildren(...batch.lines.map((l) => {
      const item = document.createElement('li');
      item.textContent = l;
      return item;
    }));
    li.append(head, lines);
    return li;
  }));
}

// ---------- talking ----------

function startListening() {
  if (!SpeechRecognitionApi || recognition) return;
  const input = $('ask-input');
  const before = input.value.trim();
  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';
  recognition.onresult = (e) => {
    let heard = '';
    for (const result of e.results) heard += result[0].transcript;
    input.value = [before, heard.trim()].filter(Boolean).join(' ');
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      $('ask-status').textContent = 'The microphone isn\'t allowed here. You can use the keyboard\'s mic instead.';
  };
  recognition.onend = () => { recognition = null; renderListening(); };
  try {
    recognition.start();
  } catch {
    recognition = null;
  }
  renderListening();
}

function stopListening() {
  recognition?.stop();
}

function renderListening() {
  const on = !!recognition;
  $('ask-mic').classList.toggle('listening', on);
  $('ask-mic').setAttribute('aria-pressed', String(on));
  $('ask-mic').setAttribute('aria-label', on ? 'Stop listening' : 'Talk');
  $('ask-listening').hidden = !on;
}

// ---------- wiring ----------

$('ask-open').addEventListener('click', openAsk);
$('ask-close').addEventListener('click', closeAsk);
$('ask-reset').addEventListener('click', resetAsk);
$('ask-sheet').addEventListener('click', (e) => { if (e.target === $('ask-sheet')) closeAsk(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ask-sheet').hidden) closeAsk(); });
$('ask-form').addEventListener('submit', (e) => { e.preventDefault(); sendAsk(); });
// Enter sends; Shift+Enter starts a new line.
$('ask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAsk(); }
});
$('ask-submit').addEventListener('click', submitAsk);
$('ask-mic').addEventListener('click', () => (recognition ? stopListening() : startListening()));
for (const example of document.querySelectorAll('.ask-example'))
  example.addEventListener('click', () => { $('ask-input').value = example.textContent; $('ask-input').focus(); });
