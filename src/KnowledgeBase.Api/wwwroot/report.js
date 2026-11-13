// The leadership report (#report, from the Projects board): pick the period and the projects, have the
// assistant write them up for leadership, read it (and edit it if needed), then save it or copy it to
// paste elsewhere. Saved reports (#reports) can be read again, copied and deleted.
// Uses $, api, showError and showToast from app.js; projects, loadProjects, boardOrder, healthBadge,
// formatTarget and HEALTH_NAME from projects.js; setStatus and todayString from workouts.js.

const REPORT_DAYS_KEY = 'kb_report_days';
const REPORT_PERIODS = { 7: 'week', 14: '2 weeks', 30: 'month' };
let reportDays = (() => {
  try {
    const saved = Number(localStorage.getItem(REPORT_DAYS_KEY));
    return REPORT_PERIODS[saved] ? saved : 14;
  } catch { return 14; }
})();
const reportLeftOut = new Set(); // projects you unticked
// The report just written, kept while it is unsaved so going back to it (after a look at a project, say)
// still shows it. The board's Leadership report button, or saving it, starts the next one afresh.
let lastReport = null;
let lastReportSaved = false;

async function showReport() {
  if (lastReportSaved) lastReport = null;
  showReportPart(lastReport ? 'result' : 'options');
  setStatus($('report-status'), '');
  renderReportOptions();
  try {
    await loadProjects();
    renderReportOptions();
  } catch (err) {
    showError(err);
  }
}

function showReportPart(part) {
  $('report-options').hidden = part !== 'options';
  $('report-busy').hidden = part !== 'busy';
  $('report-result').hidden = part !== 'result';
}

function renderReportOptions() {
  for (const b of $('report-period').querySelectorAll('button')) b.setAttribute('aria-checked', String(Number(b.dataset.days) === reportDays));
  $('report-projects').replaceChildren(...boardOrder(projects).map((p) => {
    const label = document.createElement('label');
    label.className = 'report-pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !reportLeftOut.has(p.id);
    box.addEventListener('change', () => {
      if (box.checked) reportLeftOut.delete(p.id);
      else reportLeftOut.add(p.id);
    });
    const text = document.createElement('span');
    text.className = 'report-pick-text';
    const name = document.createElement('span');
    name.className = 'report-pick-name';
    name.textContent = p.name;
    text.append(name);
    // A check when the project has an executive update for the slide.
    if (hasExecutiveUpdate(p)) {
      const exec = document.createElement('span');
      exec.className = 'report-pick-exec';
      exec.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
      exec.append('Executive update');
      text.append(exec);
    }
    label.append(box, text, healthBadge(p.health));
    return label;
  }));
  $('report-pick-exec').hidden = !projects.some(hasExecutiveUpdate);
  $('report-write').disabled = projects.length === 0;
}

const hasExecutiveUpdate = (p) => !!p.executiveUpdate?.trim();

$('report-pick-all').addEventListener('click', () => {
  reportLeftOut.clear();
  renderReportOptions();
});

// Ticks only the projects with an executive update, for a report that's just for the slide.
$('report-pick-exec').addEventListener('click', () => {
  reportLeftOut.clear();
  for (const p of projects) if (!hasExecutiveUpdate(p)) reportLeftOut.add(p.id);
  renderReportOptions();
});

$('report-period').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  reportDays = Number(b.dataset.days);
  try { localStorage.setItem(REPORT_DAYS_KEY, String(reportDays)); } catch { /* storage unavailable */ }
  renderReportOptions();
});

$('report-options').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('report-status');
  const projectIds = projects.filter((p) => !reportLeftOut.has(p.id)).map((p) => p.id);
  if (projectIds.length === 0) return setStatus(status, 'Choose at least one project.', true);
  setStatus(status, '');
  showReportPart('busy');
  try {
    lastReport = await api('/projects/report', { method: 'POST', quiet: true, body: JSON.stringify({ days: reportDays, projectIds, today: todayString() }) });
    renderReport();
    showReportPart('result');
    window.scrollTo(0, 0);
  } catch (err) {
    showReportPart('options');
    setStatus(status, err.message, true);
  }
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// A "Goal:" / "Progress:" / "Next and risks:" line; nothing when it's empty.
function reportLine(field, label, text) {
  if (!text) return [];
  const p = el('p', 'report-line');
  p.dataset.field = field;
  p.append(el('b', '', `${label}: `), text);
  return [p];
}

// The notes only for you, above a report.
function renderForYou(box, notes) {
  box.hidden = notes.length === 0;
  const list = el('ul');
  list.append(...notes.map((note) => el('li', '', note)));
  box.replaceChildren(el('p', 'report-for-you-title', 'For you, not in the report'), list);
}

function healthCounts(report) {
  return ['on_track', 'needs_attention', 'blocked']
    .map((health) => ({ health, n: report.projects.filter((p) => p.health === health).length }))
    .filter((c) => c.n > 0);
}

const periodName = (days) => `last ${REPORT_PERIODS[days] ?? `${days} days`}`;

// A report (just written, or saved) into `doc`: its heading, counts, summary and each project.
function renderReportDoc(doc, report) {
  const counts = el('p', 'report-counts');
  counts.append(...healthCounts(report).map((c) => healthBadge(c.health, `${c.n} ${HEALTH_NAME[c.health].toLowerCase()}`)));
  doc.replaceChildren(
    el('p', 'report-kicker', `Work projects · ${formatTarget(report.date)}`),
    el('h2', 'report-title', 'Status report'),
    counts,
    el('p', 'report-summary', report.summary),
    ...report.projects.map((p, i) => {
      const section = el('section', 'report-project');
      section.dataset.health = p.health;
      section.dataset.index = i;
      const head = el('div', 'report-project-head');
      head.append(el('h3', 'report-name', p.name), healthBadge(p.health));
      const meta = el('p', 'report-meta', [p.category, p.targetDate && `Target ${formatTarget(p.targetDate)}`].filter(Boolean).join(' · '));
      section.append(head, meta, ...reportLine('goal', 'Goal', p.goal), ...reportLine('progress', 'Progress', p.progress), ...reportLine('next', 'Next and risks', p.next));
      return section;
    }),
    ...slideSection(report),
  );
}

// "Update for CV Cloud Tech Slide": each project's executive update exactly as you wrote it, ready to paste on
// the slide. It can't be edited here (change it on the project's page) and has its own Copy button.
const SLIDE_TITLE = 'Update for CV Cloud Tech Slide';

function slideSection(report) {
  const updates = report.projects.filter((p) => p.executiveUpdate?.trim());
  if (!updates.length) return [];
  const section = el('section', 'report-slide');
  section.contentEditable = 'false';
  const head = el('div', 'report-slide-head');
  const copy = el('button', 'report-slide-copy link', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(slideText(section));
      showToast('Copied the slide update.');
    } catch {
      showToast("Couldn't copy the slide update.", 'warn');
    }
  });
  head.append(el('h3', 'report-slide-title', SLIDE_TITLE), copy);
  section.append(head, ...updates.map((p) => {
    const item = el('div', 'report-slide-item');
    item.append(el('p', 'report-slide-name', p.name), el('p', 'report-slide-text', p.executiveUpdate));
    return item;
  }));
  return [section];
}

// Each project's name, then its update word for word.
function slideText(section) {
  return [...section.querySelectorAll('.report-slide-item')]
    .map((item) => `${item.querySelector('.report-slide-name').textContent}\n${item.querySelector('.report-slide-text').textContent}`)
    .join('\n\n');
}

function renderReport() {
  renderForYou($('report-for-you'), lastReport.forYou);
  const doc = $('report-doc');
  doc.contentEditable = 'false';
  $('report-edit').textContent = 'Edit';
  renderReportDoc(doc, lastReport);
  markSaved(false);
}

// The report as plain text to paste into an email or a chat, read from the page so your edits are kept.
function reportText(doc) {
  const blocks = [];
  for (const node of doc.children) {
    if (node.classList.contains('report-project')) {
      const name = node.querySelector('.report-name')?.innerText.trim() ?? '';
      const lines = [`${name.toUpperCase()} (${HEALTH_NAME[node.dataset.health]})`];
      for (const line of node.querySelectorAll('.report-meta, .report-line')) lines.push(line.innerText.trim());
      blocks.push(lines.filter(Boolean).join('\n'));
    } else if (node.classList.contains('report-slide')) {
      blocks.push(`${SLIDE_TITLE.toUpperCase()}\n\n${slideText(node)}`);
    } else if (node.classList.contains('report-kicker') || node.classList.contains('report-title')) {
      blocks.push(node.textContent.trim()); // as typed, not in the capitals they show in
    } else if (node.classList.contains('report-counts')) {
      blocks.push([...node.children].map((c) => c.innerText.trim()).join(' · '));
    } else {
      blocks.push(node.innerText.trim());
    }
  }
  return blocks.filter(Boolean).join('\n\n');
}

// The report as it now reads on the page (with your edits), to save.
function editedReport() {
  const doc = $('report-doc');
  const read = (node) => node?.innerText.trim() ?? '';
  return {
    ...lastReport,
    summary: read(doc.querySelector('.report-summary')),
    projects: [...doc.querySelectorAll('.report-project')].map((section) => {
      const field = (name) => {
        const line = section.querySelector(`.report-line[data-field="${name}"]`);
        return read(line).replace(/^[^:]{1,20}:\s*/, ''); // without its "Goal:" label
      };
      return {
        ...lastReport.projects[section.dataset.index],
        name: read(section.querySelector('.report-name')),
        goal: field('goal'),
        progress: field('progress'),
        next: field('next'),
      };
    }),
  };
}

$('report-edit').addEventListener('click', () => {
  const doc = $('report-doc');
  const editing = doc.contentEditable !== 'true';
  doc.contentEditable = String(editing);
  $('report-edit').textContent = editing ? 'Done editing' : 'Edit';
  if (editing) doc.focus();
});

// Save turns into "Saved" until you change the report again, so it isn't saved twice by accident.
function markSaved(saved) {
  lastReportSaved = saved;
  const save = $('report-save');
  save.disabled = saved;
  save.textContent = saved ? 'Saved ✓' : 'Save';
}
$('report-doc').addEventListener('input', () => markSaved(false));

$('report-save').addEventListener('click', async () => {
  const save = $('report-save');
  save.disabled = true;
  try {
    await api('/reports', { method: 'POST', body: JSON.stringify(editedReport()) });
    markSaved(true);
    showToast('Saved the report.');
  } catch (err) {
    save.disabled = false;
    showToast(err.message, 'warn');
  }
});

async function copyReport(doc) {
  try {
    await navigator.clipboard.writeText(reportText(doc));
    showToast('Copied the report.');
  } catch {
    showToast("Couldn't copy the report.", 'warn');
  }
}

$('report-copy').addEventListener('click', () => copyReport($('report-doc')));

// The report as a Word document, laid out like the status report you write by hand (the server builds it;
// see ReportDocument.cs). On a phone it goes to the share sheet (Word, OneDrive, Mail...); elsewhere it downloads.
async function downloadWord(report, button) {
  button.disabled = true;
  try {
    const res = await fetch('/reports/docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status}).`);
    const name = `Status report ${report.date}.docx`;
    const file = new File([await res.blob()], name, { type: res.headers.get('Content-Type') ?? '' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name }).catch(() => {}); // closing the sheet isn't an error
    } else {
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      showToast('Downloaded the Word document.');
    }
  } catch (err) {
    showToast(`Couldn't make the Word document: ${err.message}`, 'warn');
  } finally {
    button.disabled = false;
  }
}

$('report-word').addEventListener('click', () => downloadWord(editedReport(), $('report-word')));

$('report-redo').addEventListener('click', () => {
  lastReport = null;
  showReportPart('options');
  window.scrollTo(0, 0);
});

// ---------- saved reports ----------

// Saved reports (#reports, from Settings or the board): newest first, to open, or to delete a few or all.
let savedReports = [];
const selectedReports = new Set();

const longDate = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

async function loadSavedReports() {
  savedReports = await api('/reports');
  for (const id of [...selectedReports]) if (!savedReports.some((r) => r.id === id)) selectedReports.delete(id);
}

// The "Saved reports" count in Settings and on the board.
async function updateSavedReportsCount() {
  try {
    await loadSavedReports();
    for (const id of ['settings-reports-count', 'board-reports-count']) $(id).textContent = savedReports.length || '';
  } catch { /* the count can wait */ }
}

async function showSavedReports() {
  renderSavedReports();
  try {
    await loadSavedReports();
    renderSavedReports();
  } catch (err) {
    showError(err);
  }
}

function renderSavedReports() {
  const n = savedReports.length;
  $('reports-count').textContent = n === 0 ? '' : `${n} report${n === 1 ? '' : 's'}, newest first. Tap one to read or copy it.`;
  $('no-reports').hidden = n > 0;
  $('reports-tools').hidden = n === 0;
  $('reports-list').replaceChildren(...savedReports.map((report) => {
    const li = el('li', 'saved-report-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedReports.has(report.id);
    box.setAttribute('aria-label', `Select the report of ${longDate(report.date)}`);
    box.addEventListener('change', () => {
      if (box.checked) selectedReports.add(report.id);
      else selectedReports.delete(report.id);
      renderReportSelection();
    });
    const link = el('a', 'saved-report-open');
    link.href = `#reports/${report.id}`;
    const counts = el('span', 'report-counts');
    counts.append(...healthCounts(report).map((c) => healthBadge(c.health, `${c.n} ${HEALTH_NAME[c.health].toLowerCase()}`)));
    link.append(
      el('span', 'saved-report-when', longDate(report.date)),
      el('span', 'saved-report-sub', `${periodName(report.days).replace(/^l/, 'L')} · ${report.projects.length} project${report.projects.length === 1 ? '' : 's'}`),
      counts,
    );
    li.append(box, link);
    return li;
  }));
  renderReportSelection();
}

function renderReportSelection() {
  const n = selectedReports.size;
  $('reports-selected').textContent = n ? `${n} selected` : '';
  $('reports-select-all').textContent = n === savedReports.length && n > 0 ? 'Select none' : 'Select all';
  $('reports-delete-selected').disabled = n === 0;
  $('reports-delete-selected').textContent = n ? `Delete (${n})` : 'Delete selected';
}

$('reports-select-all').addEventListener('click', () => {
  const all = selectedReports.size === savedReports.length;
  selectedReports.clear();
  if (!all) for (const r of savedReports) selectedReports.add(r.id);
  renderSavedReports();
});

$('reports-delete-selected').addEventListener('click', async () => {
  const ids = [...selectedReports];
  if (!ids.length || !confirm(`Delete ${ids.length} saved report${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return;
  try {
    await Promise.all(ids.map((id) => api(`/reports/${id}`, { method: 'DELETE' })));
    showToast(`Deleted ${ids.length} report${ids.length === 1 ? '' : 's'}.`);
  } catch (err) {
    showToast(err.message, 'warn');
  }
  selectedReports.clear();
  showSavedReports();
});

$('reports-delete-all').addEventListener('click', async () => {
  if (!confirm(`Delete all ${savedReports.length} saved reports? This can't be undone.`)) return;
  try {
    const { deleted } = await api('/reports', { method: 'DELETE' });
    showToast(`Deleted ${deleted} report${deleted === 1 ? '' : 's'}.`);
  } catch (err) {
    showToast(err.message, 'warn');
  }
  selectedReports.clear();
  showSavedReports();
});

// One saved report (#reports/<id>), as it was saved.
let openReportId = null;
let openReport = null; // the saved report on screen, for its Word document

async function showSavedReport(id) {
  openReportId = id;
  $('saved-report').classList.add('is-loading');
  let report;
  try {
    report = await api(`/reports/${id}`);
  } catch (err) {
    return showError(err);
  }
  if (openReportId !== id) return;
  $('saved-report').classList.remove('is-loading');
  const at = new Date(report.savedAt);
  $('saved-report-when').textContent = `Saved ${longDate(report.date)} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  renderForYou($('saved-for-you'), report.forYou);
  renderReportDoc($('saved-report-doc'), report);
  openReport = report;
}

$('saved-copy').addEventListener('click', () => copyReport($('saved-report-doc')));
$('saved-word').addEventListener('click', () => openReport && downloadWord(openReport, $('saved-word')));

$('saved-delete').addEventListener('click', async () => {
  if (!openReportId || !confirm("Delete this saved report? This can't be undone.")) return;
  try {
    await api(`/reports/${openReportId}`, { method: 'DELETE' });
    selectedReports.delete(openReportId);
    location.replace('#reports');
    showToast('Deleted the report.');
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

// The board's button always starts a new report, with the projects as they are now.
$('open-report').addEventListener('click', () => {
  lastReport = null;
  lastReportSaved = false;
});
