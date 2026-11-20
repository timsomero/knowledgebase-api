using System.Globalization;
using KnowledgeBase.Api.Projects;
using KnowledgeBase.Api.Settings;
using KnowledgeBase.Api.Tasks;
using KnowledgeBase.Api.Workouts;

namespace KnowledgeBase.Api.Assistant;

// Message: what you typed or said. PlanId: the plan you are refining (or answering a question on); none for a
// new request. Today: your local date, for "today", "Monday" and so on.
public record PlanRequest(string? Message, Guid? PlanId, DateOnly? Today);

// ChangeIds: the changes you left ticked; all of them when left out.
public record ApplyRequest(IReadOnlyList<string>? ChangeIds);

// Status: "applied", or "skipped" with Reason (for example, the task was changed or deleted since the preview).
public record ChangeResult(string ChangeId, string Status, string? Reason);

public record ApplyResult(AssistantBatch? Batch, IReadOnlyList<ChangeResult> Results);

public record UndoResult(AssistantBatch Batch, int Undone, IReadOnlyList<string> Skipped);

public static class AssistantEndpoints
{
    private const int MaxMessageLength = 4000;
    private const int MaxTurns = 20;

    public static void MapAssistantEndpoints(this IEndpointRouteBuilder app)
    {
        // Plans changes for a request (or refines a plan) without changing anything: the answer is the plan
        // to preview, which the server keeps until it is submitted.
        app.MapPost("/assistant/plan", async (PlanRequest request, IAssistantPlanner planner, IAssistantStore store,
            ITaskStore tasks, IProjectStore projects, IWorkoutStore workouts, IWorkoutConfigStore workoutConfig, ISettingsStore settings) =>
        {
            if (!planner.Enabled)
                return Results.BadRequest(new { error = "The assistant isn't set up (no ANTHROPIC_API_KEY)." });
            var message = request.Message?.Trim() ?? "";
            if (message.Length is 0 or > MaxMessageLength)
                return Results.BadRequest(new { error = $"Say what to change (up to {MaxMessageLength} characters)." });

            AssistantPlan? plan = null;
            if (request.PlanId is { } planId)
            {
                plan = await store.GetPlanAsync(planId);
                if (plan is null)
                    return Results.NotFound();
                if (plan.Applied)
                    return Results.Conflict(new { error = "This plan was already submitted. Start a new request." });
                if (plan.Turns.Count >= MaxTurns)
                    return Results.BadRequest(new { error = "This conversation is long enough. Submit it or start over." });
            }

            var today = request.Today ?? plan?.Today ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var toolbox = await AssistantToolbox.LoadAsync(today, plan?.Changes ?? [], tasks, projects, workouts, workoutConfig, settings);

            // Not tied to the request, so a dropped connection doesn't waste a half-finished plan... but bounded.
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            var history = plan?.Turns ?? [];
            if (await planner.PlanAsync(history, message, toolbox, timeout.Token) is not { } result)
                return Results.Json(new { error = "The assistant couldn't be reached. Try again in a moment." }, statusCode: 503);

            List<AssistantTurn> turns = [.. history, new("user", message)];
            if (result.Question is not null)
                turns.Add(new("assistant", result.Question));

            var now = DateTimeOffset.UtcNow;
            var saved = new AssistantPlan(
                plan?.Id ?? Guid.NewGuid(),
                plan?.CreatedAt ?? now,
                now,
                today,
                turns,
                result.Question is null ? result.Summary : plan?.Summary ?? "",
                result.Question,
                result.Choices,
                toolbox.Changes,
                false);
            await store.SavePlanAsync(saved);
            return Results.Ok(saved);
        });

        app.MapGet("/assistant/plans/{id:guid}", async (Guid id, IAssistantStore store) =>
            await store.GetPlanAsync(id) is { } plan ? Results.Ok(plan) : Results.NotFound());

        // Carries out exactly the previewed changes you left ticked, once. A task or project changed since
        // the preview is left alone (reported as skipped).
        app.MapPost("/assistant/plans/{id:guid}/apply", async (Guid id, ApplyRequest request, IAssistantStore store,
            ITaskStore tasks, IProjectStore projects, IWorkoutStore workouts, IWorkoutConfigStore workoutConfig) =>
        {
            if (await store.GetPlanAsync(id) is not { } plan)
                return Results.NotFound();
            if (plan.Applied)
                return Results.Conflict(new { error = "This plan was already submitted." });
            if (plan.Question is not null)
                return Results.BadRequest(new { error = "Answer the question first." });

            // Marked first, so a second tap (or a retry) can't apply it twice.
            await store.SavePlanAsync(plan with { Applied = true, UpdatedAt = DateTimeOffset.UtcNow });

            var chosen = request.ChangeIds is { } ids ? plan.Changes.Where(c => ids.Contains(c.Id)).ToList() : plan.Changes.ToList();
            var config = await workoutConfig.GetAsync();
            var results = new List<ChangeResult>();
            var steps = new List<UndoStep>();
            var lines = new List<string>();
            foreach (var change in chosen)
            {
                var (step, reason) = await ApplyAsync(change, tasks, projects, workouts, config);
                if (step is null)
                {
                    results.Add(new(change.Id, "skipped", reason));
                    continue;
                }
                results.Add(new(change.Id, "applied", null));
                steps.Add(step);
                lines.Add(Line(change));
            }

            AssistantBatch? batch = null;
            if (steps.Count > 0)
            {
                batch = new AssistantBatch(Guid.NewGuid(), plan.Id, DateTimeOffset.UtcNow, plan.Summary, lines, steps, null);
                await store.SaveBatchAsync(batch);
            }
            return Results.Ok(new ApplyResult(batch, results));
        });

        app.MapGet("/assistant/batches", async (IAssistantStore store) => Results.Ok(await store.ListBatchesAsync(10)));

        // Reverses a submitted batch, as far as nothing was changed by hand since.
        app.MapPost("/assistant/batches/{id:guid}/undo", async (Guid id, IAssistantStore store,
            ITaskStore tasks, IProjectStore projects, IWorkoutStore workouts) =>
        {
            if (await store.GetBatchAsync(id) is not { } batch)
                return Results.NotFound();
            if (batch.UndoneAt is not null)
                return Results.Conflict(new { error = "Already undone." });

            var undone = 0;
            var skipped = new List<string>();
            // Last change first.
            for (var i = batch.Steps.Count - 1; i >= 0; i--)
            {
                if (await UndoAsync(batch.Steps[i], tasks, projects, workouts) is { } reason)
                    skipped.Add($"{batch.Lines.ElementAtOrDefault(i) ?? batch.Steps[i].Kind}: {reason}");
                else
                    undone++;
            }

            var saved = batch with { UndoneAt = DateTimeOffset.UtcNow };
            await store.SaveBatchAsync(saved);
            return Results.Ok(new UndoResult(saved, undone, skipped));
        });
    }

    // ---------- applying ----------

    private static async Task<(UndoStep? Step, string? Reason)> ApplyAsync(AssistantChange change, ITaskStore tasks, IProjectStore projects,
        IWorkoutStore workouts, WorkoutConfig config)
    {
        var now = DateTimeOffset.UtcNow;
        switch (change.Kind)
        {
            case "task_update" when change.TargetId is { } taskId && change.Task is { } patch:
            {
                if (await tasks.GetAsync(taskId) is not { } task)
                    return (null, "The task was deleted.");
                if (task.UpdatedAt != change.TargetUpdatedAt)
                    return (null, "The task was changed since the preview.");

                var before = new TaskPatch(
                    patch.Title is null ? null : task.Title,
                    patch.Notes is null ? null : task.Notes ?? "",
                    patch.DueDate is null && !patch.ClearDueDate ? null : task.DueDate,
                    false,
                    patch.Status is null ? null : task.Status,
                    patch.Priority is null ? null : task.Priority);
                var hadNoDueDate = (patch.DueDate is not null || patch.ClearDueDate) && task.DueDate is null;
                var updated = Patch(task, patch) with { UpdatedAt = now };
                await tasks.UpdateAsync(updated);
                return (new UndoStep(change.Kind, taskId, now, before, hadNoDueDate, null, null, null), null);
            }
            case "task_create" when change.NewTask is { } draft:
            {
                var task = new TaskItem(Guid.NewGuid(), draft.Title, draft.Notes, TaskState.Todo, draft.Priority, draft.DueDate, [],
                    draft.DelegatedTo, draft.Area, draft.Area == TaskArea.Work ? draft.Category : null, now, now, null, [], []);
                await tasks.AddAsync(task);
                return (new UndoStep(change.Kind, task.Id, now, null, false, null, null, task.Id), null);
            }
            case "task_activity" when change.TargetId is { } taskId && change.Text is { } text:
            {
                var entry = new TaskLogEntry(Guid.NewGuid(), now, text);
                if (!await tasks.AddLogAsync(taskId, entry))
                    return (null, "The task was deleted.");
                return (new UndoStep(change.Kind, taskId, null, null, false, null, entry.Id, null), null);
            }
            case "project_update" when change.TargetId is { } projectId:
            {
                if (await projects.GetAsync(projectId) is not { } project)
                    return (null, "The project was deleted.");
                ProjectHealth? healthBefore = null;
                DateTimeOffset? appliedAt = null;
                if (change.Health is { } health && health != project.Health)
                {
                    healthBefore = project.Health;
                    appliedAt = now;
                    await projects.UpdateAsync(project with { Health = health, UpdatedAt = now });
                    await projects.AddLogAsync(projectId, new ProjectLogEntry(Guid.NewGuid(), now,
                        $"Health: {ProjectEndpoints.HealthNames[project.Health]} → {ProjectEndpoints.HealthNames[health]}", Auto: true));
                }
                Guid? entryId = null;
                if (change.Text is { } text)
                {
                    var entry = new ProjectLogEntry(Guid.NewGuid(), now, text, Auto: false);
                    await projects.AddLogAsync(projectId, entry);
                    entryId = entry.Id;
                }
                return (new UndoStep(change.Kind, projectId, appliedAt, null, false, healthBefore, entryId, null), null);
            }
            case "project_archive" or "project_restore" when change.TargetId is { } projectId:
            {
                if (await projects.GetAsync(projectId) is not { } project)
                    return (null, "The project was deleted.");
                var archive = change.Kind == "project_archive";
                if (project.ArchivedAt is not null == archive)
                    return (null, archive ? "The project was already archived." : "The project was already restored.");
                var saved = await ProjectEndpoints.SetArchivedAsync(projects, project, archive, now);
                return (new UndoStep(change.Kind, projectId, saved.UpdatedAt, null, false, null, null, null), null);
            }
            case "workout_create" when change.Workout is { } draft:
            {
                if (config.Categories.FirstOrDefault(c => c.Id == draft.CategoryId) is not { } category)
                    return (null, "That workout category was removed.");
                var workout = new Workout(Guid.NewGuid(), draft.Date, category.Id, category.Name, category.Kind,
                    category.Kind == WorkoutKind.Activity ? draft.Activity : null,
                    category.Kind == WorkoutKind.Checklist ? draft.Items : [],
                    category.Kind == WorkoutKind.Activity ? draft.DurationMinutes : null,
                    category.Kind == WorkoutKind.Activity ? draft.DistanceMiles : null,
                    draft.Notes, now, now);
                await workouts.AddAsync(workout);
                return (new UndoStep(change.Kind, workout.Id, now, null, false, null, null, workout.Id), null);
            }
            default:
                return (null, "Unknown change.");
        }
    }

    private static TaskItem Patch(TaskItem task, TaskPatch patch)
    {
        if (patch.Title is { } title)
            task = task with { Title = title };
        if (patch.Notes is { } notes)
            task = task with { Notes = string.IsNullOrWhiteSpace(notes) ? null : notes };
        if (patch.ClearDueDate)
            task = task with { DueDate = null };
        else if (patch.DueDate is { } due)
            task = task with { DueDate = due };
        if (patch.Priority is { } priority)
            task = task with { Priority = priority };
        if (patch.Status is { } status && status != task.Status)
            task = task with { Status = status, CompletedAt = status == TaskState.Done ? DateTimeOffset.UtcNow : null };
        return task;
    }

    // ---------- undoing ----------

    // Null when undone; otherwise why it was left as it is.
    private static async Task<string?> UndoAsync(UndoStep step, ITaskStore tasks, IProjectStore projects, IWorkoutStore workouts)
    {
        switch (step.Kind)
        {
            case "task_update" when step.Before is { } before:
            {
                if (await tasks.GetAsync(step.TargetId) is not { } task)
                    return "the task was deleted";
                if (task.UpdatedAt != step.AppliedUpdatedAt)
                    return "the task was changed since";
                var restore = before with { ClearDueDate = step.BeforeHadNoDueDate };
                await tasks.UpdateAsync(Patch(task, restore) with { UpdatedAt = DateTimeOffset.UtcNow });
                return null;
            }
            case "task_create":
            {
                if (await tasks.GetAsync(step.TargetId) is not { } task)
                    return null; // already gone
                if (task.UpdatedAt != step.AppliedUpdatedAt || task.Photos.Count > 0 || task.Log.Count > 0)
                    return "the task was changed since";
                await tasks.DeleteAsync(task.Id);
                return null;
            }
            case "task_activity" when step.LogEntryId is { } entryId:
                await tasks.RemoveLogAsync(step.TargetId, entryId);
                return null;
            case "project_update":
            {
                if (step.LogEntryId is { } entryId)
                    await projects.RemoveLogAsync(step.TargetId, entryId);
                if (step.HealthBefore is not { } health)
                    return null;
                if (await projects.GetAsync(step.TargetId) is not { } project)
                    return "the project was deleted";
                if (project.UpdatedAt != step.AppliedUpdatedAt)
                    return "the project's health was changed since";
                var now = DateTimeOffset.UtcNow;
                await projects.UpdateAsync(project with { Health = health, UpdatedAt = now });
                await projects.AddLogAsync(project.Id, new ProjectLogEntry(Guid.NewGuid(), now,
                    $"Health: {ProjectEndpoints.HealthNames[project.Health]} → {ProjectEndpoints.HealthNames[health]}", Auto: true));
                return null;
            }
            case "project_archive" or "project_restore":
            {
                if (await projects.GetAsync(step.TargetId) is not { } project)
                    return "the project was deleted";
                if (project.UpdatedAt != step.AppliedUpdatedAt)
                    return "the project was changed since";
                await ProjectEndpoints.SetArchivedAsync(projects, project, step.Kind != "project_archive", DateTimeOffset.UtcNow);
                return null;
            }
            case "workout_create":
            {
                if (await workouts.GetAsync(step.TargetId) is not { } workout)
                    return null;
                if (workout.UpdatedAt != step.AppliedUpdatedAt)
                    return "the workout was edited since";
                await workouts.DeleteAsync(workout.Id);
                return null;
            }
            default:
                return "nothing to undo";
        }
    }

    // ---------- wording ----------

    private static string Line(AssistantChange c) => c.Kind switch
    {
        "task_update" when c.Fields is [{ Field: "dueDate", After: { } due }] => $"Moved “{c.Title}” to {Friendly(due)}",
        "task_update" when c.Fields is [{ Field: "dueDate", After: null }] => $"Removed the due date from “{c.Title}”",
        "task_update" when c.Fields is [{ Field: "status", After: "done" }] => $"Marked “{c.Title}” done",
        "task_update" => $"Updated “{c.Title}”",
        "task_create" => $"Added the task “{c.Title}”",
        "task_activity" => $"Added to “{c.Title}”: {c.Text}",
        "project_update" when c.Text is not null => $"{c.Title}: {c.Text}",
        "project_update" => $"{c.Title}: health {ProjectEndpoints.HealthNames[c.Health!.Value]}",
        "project_archive" => $"Archived “{c.Title}”",
        "project_restore" => $"Restored “{c.Title}”",
        "workout_create" => $"Logged {c.Title}",
        _ => c.Title,
    };

    private static string Friendly(string day) =>
        AssistantToolbox.ParseDay(day) is { } d ? d.ToString("ddd, MMM d", CultureInfo.InvariantCulture) : day;
}
