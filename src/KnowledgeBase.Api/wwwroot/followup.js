// A follow-up email for a delegated task (#followup/<task id>): a subject and a body to copy into a new
// Outlook email, each with its own Copy button. You add the greeting and sign-off yourself; nothing is sent
// from the app and nothing goes to the assistant.
// Uses $, api, tasks, showError and showToast from app.js.

const FOLLOW_UP_STATUS = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const FOLLOW_UP_PRIORITY = { low: 'Low', normal: 'Normal', high: 'High' };

const dueDate = (due) => {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// "Follow-up: Send the Q4 vendor scorecard (due Fri, Nov 13)"
function followUpSubject(task) {
  const due = task.dueDate && dueDate(task.dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Follow-up: ${task.title}${due ? ` (due ${due})` : ''}`;
}

// The opening line, then the task's details, one per line; empty ones are left out.
function followUpBody(task) {
  const due = task.dueDate && dueDate(task.dueDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const details = [
    `Task: ${task.title}`,
    due && `Due: ${due}`,
    `Priority: ${FOLLOW_UP_PRIORITY[task.priority] ?? task.priority}`,
    `Status: ${FOLLOW_UP_STATUS[task.status] ?? task.status}`,
    task.notes?.trim() && `Notes: ${task.notes.trim()}`,
  ].filter(Boolean);
  return `I'm following up on a task. The details are below.\n\n${details.join('\n')}`;
}

async function showFollowUp(id) {
  let task = tasks.find((t) => t.id === id);
  if (!task) {
    try {
      task = await api(`/tasks/${id}`);
    } catch (err) {
      return showError(err);
    }
  }
  $('followup-who').textContent = task.delegatedTo || 'them';
  $('followup-subject').value = followUpSubject(task);
  $('followup-body').value = followUpBody(task);
}

async function copyFollowUp(field, what) {
  try {
    await navigator.clipboard.writeText($(field).value);
    showToast(`Copied the ${what}.`);
  } catch {
    // Older browsers: select it so it can be copied by hand.
    $(field).select();
    showToast(`Couldn't copy the ${what}; it's selected so you can copy it.`, 'warn');
  }
}

$('followup-copy-subject').addEventListener('click', () => copyFollowUp('followup-subject', 'subject'));
$('followup-copy-body').addEventListener('click', () => copyFollowUp('followup-body', 'body'));
