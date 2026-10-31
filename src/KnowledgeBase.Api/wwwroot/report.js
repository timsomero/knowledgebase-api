// The leadership report (#report, from the Projects board): pick the period and the projects, have the
// assistant write them up for leadership, read it (and edit it if needed), then share it with the phone's
// share sheet or copy it.
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
let lastReport = null; // kept while the app is open, so a look at a project and back still shows it

async function showReport() {
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
    const name = document.createElement('span');
    name.className = 'report-pick-name';
    name.textContent = p.name;
    label.append(box, name, healthBadge(p.health));
    return label;
  }));
  $('report-write').disabled = projects.length === 0;
}

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
    lastReport = await api('/projects/report', { method: 'POST', body: JSON.stringify({ days: reportDays, projectIds, today: todayString() }) });
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
function reportLine(label, text) {
  if (!text) return [];
  const p = el('p', 'report-line');
  p.dataset.label = label;
  p.append(el('b', '', `${label}: `), text);
  return [p];
}

function renderReport() {
  const report = lastReport;
  const forYou = $('report-for-you');
  forYou.hidden = report.forYou.length === 0;
  const list = el('ul');
  list.append(...report.forYou.map((note) => el('li', '', note)));
  forYou.replaceChildren(el('p', 'report-for-you-title', 'For you, not in the report'), list);

  const counts = el('p', 'report-counts');
  for (const health of ['on_track', 'needs_attention', 'blocked']) {
    const n = report.projects.filter((p) => p.health === health).length;
    if (n) counts.append(healthBadge(health, `${n} ${HEALTH_NAME[health].toLowerCase()}`));
  }

  const doc = $('report-doc');
  doc.contentEditable = 'false';
  $('report-edit').textContent = 'Edit';
  doc.replaceChildren(
    el('p', 'report-kicker', `Work projects · ${formatTarget(report.date)} · last ${REPORT_PERIODS[report.days] ?? `${report.days} days`}`),
    el('h2', 'report-title', 'Status report'),
    counts,
    el('p', 'report-summary', report.summary),
    ...report.projects.map((p) => {
      const section = el('section', 'report-project');
      section.dataset.health = p.health;
      const head = el('div', 'report-project-head');
      head.append(el('h3', 'report-name', p.name), healthBadge(p.health));
      const meta = el('p', 'report-meta', [p.category, p.targetDate && `Target ${formatTarget(p.targetDate)}`].filter(Boolean).join(' · '));
      section.append(head, meta, ...reportLine('Goal', p.goal), ...reportLine('Progress', p.progress), ...reportLine('Next and risks', p.next));
      return section;
    }),
  );
}

// The report as plain text for email or a chat, read from the page so your edits are kept.
function reportText() {
  const blocks = [];
  for (const node of $('report-doc').children) {
    if (node.classList.contains('report-project')) {
      const name = node.querySelector('.report-name')?.innerText.trim() ?? '';
      const lines = [`${name.toUpperCase()} (${HEALTH_NAME[node.dataset.health]})`];
      for (const line of node.querySelectorAll('.report-meta, .report-line')) lines.push(line.innerText.trim());
      blocks.push(lines.filter(Boolean).join('\n'));
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

$('report-edit').addEventListener('click', () => {
  const doc = $('report-doc');
  const editing = doc.contentEditable !== 'true';
  doc.contentEditable = String(editing);
  $('report-edit').textContent = editing ? 'Done editing' : 'Edit';
  if (editing) doc.focus();
});

async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportText());
    showToast('Copied the report.');
  } catch {
    showToast("Couldn't copy the report.", 'warn');
  }
}

$('report-share').addEventListener('click', async () => {
  if (!navigator.share) return copyReport();
  try {
    await navigator.share({ title: 'Work projects status report', text: reportText() });
  } catch (err) {
    if (err.name !== 'AbortError') showToast(err.message, 'warn');
  }
});

$('report-copy').addEventListener('click', copyReport);

$('report-redo').addEventListener('click', () => {
  lastReport = null;
  showReportPart('options');
  window.scrollTo(0, 0);
});
