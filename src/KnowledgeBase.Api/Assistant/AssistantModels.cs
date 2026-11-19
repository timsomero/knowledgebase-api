using System.Collections.Concurrent;
using KnowledgeBase.Api.Projects;
using KnowledgeBase.Api.Tasks;

namespace KnowledgeBase.Api.Assistant;

// One change the assistant proposes. Nothing is written until you submit the plan; then the server carries
// out exactly these changes (only the ones you left ticked). Kind is one of:
//  - "task_update": Task holds the fields to change on the task TargetId.
//  - "task_create": NewTask is the task to add.
//  - "task_activity": Text is a line for the task TargetId's activity.
//  - "project_update": Text (a line for the project's activity) and/or Health, on the project TargetId.
//  - "workout_create": Workout is the workout to log.
// Title and Fields are for the preview: what it is (a task's title, a project's name, "Cardio: Cycling") and,
// field by field, the value before and after (dates as yyyy-MM-dd; the web app words them).
// TargetUpdatedAt is when the task or project last changed as the preview saw it, so a task changed since is
// left alone instead of being overwritten.
public record AssistantChange(
    string Id,
    string Kind,
    string Title,
    IReadOnlyList<FieldChange> Fields,
    string? Text,
    Guid? TargetId,
    DateTimeOffset? TargetUpdatedAt,
    TaskPatch? Task,
    NewTaskDraft? NewTask,
    ProjectHealth? Health,
    WorkoutDraft? Workout);

public record FieldChange(string Field, string? Before, string? After);

// Only the fields that are set change. ClearDueDate removes the due date.
public record TaskPatch(
    string? Title = null,
    string? Notes = null,
    DateOnly? DueDate = null,
    bool ClearDueDate = false,
    TaskState? Status = null,
    TaskPriority? Priority = null);

public record NewTaskDraft(
    string Title,
    string? Notes,
    DateOnly? DueDate,
    TaskPriority Priority,
    TaskArea Area,
    string? Category,
    string? DelegatedTo);

public record WorkoutDraft(
    DateOnly Date,
    string CategoryId,
    string? Activity,
    IReadOnlyList<string> Items,
    int? DurationMinutes,
    double? DistanceMiles,
    string? Notes);

// One step of the conversation: what you said ("user") or what the assistant asked back ("assistant").
public record AssistantTurn(string Role, string Text);

// A proposed set of changes, kept on the server between the preview and Submit. Refining it replaces
// Changes; Submit carries them out and marks it applied, so it can't be submitted twice.
// Question (with Choices to tap) is set when the assistant needs you to say which one you meant.
public record AssistantPlan(
    Guid Id,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateOnly Today,
    IReadOnlyList<AssistantTurn> Turns,
    string Summary,
    string? Question,
    IReadOnlyList<string> Choices,
    IReadOnlyList<AssistantChange> Changes,
    bool Applied);

// What one applied change did, enough to undo it: the task's or project's values before (Before), its
// UpdatedAt right after the change (so a later edit isn't undone), and what was added (CreatedId: a task or
// workout; LogEntryId: an activity line).
public record UndoStep(
    string Kind,
    Guid TargetId,
    DateTimeOffset? AppliedUpdatedAt,
    TaskPatch? Before,
    bool BeforeHadNoDueDate,
    ProjectHealth? HealthBefore,
    Guid? LogEntryId,
    Guid? CreatedId);

// A submitted plan. Lines say what was done, for the confirmation and Settings → Assistant history.
public record AssistantBatch(
    Guid Id,
    Guid PlanId,
    DateTimeOffset At,
    string Summary,
    IReadOnlyList<string> Lines,
    IReadOnlyList<UndoStep> Steps,
    DateTimeOffset? UndoneAt);

public interface IAssistantStore
{
    Task<AssistantPlan?> GetPlanAsync(Guid id);
    Task SavePlanAsync(AssistantPlan plan);
    // Newest first, at most `limit`.
    Task<IReadOnlyList<AssistantBatch>> ListBatchesAsync(int limit);
    Task<AssistantBatch?> GetBatchAsync(Guid id);
    Task SaveBatchAsync(AssistantBatch batch);
}

// Used for local development; data is lost when the process stops.
public class InMemoryAssistantStore : IAssistantStore
{
    private readonly ConcurrentDictionary<Guid, AssistantPlan> _plans = new();
    private readonly ConcurrentDictionary<Guid, AssistantBatch> _batches = new();

    public Task<AssistantPlan?> GetPlanAsync(Guid id) => Task.FromResult(_plans.TryGetValue(id, out var plan) ? plan : null);

    public Task SavePlanAsync(AssistantPlan plan)
    {
        _plans[plan.Id] = plan;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<AssistantBatch>> ListBatchesAsync(int limit) =>
        Task.FromResult<IReadOnlyList<AssistantBatch>>(_batches.Values.OrderByDescending(b => b.At).Take(limit).ToList());

    public Task<AssistantBatch?> GetBatchAsync(Guid id) => Task.FromResult(_batches.TryGetValue(id, out var batch) ? batch : null);

    public Task SaveBatchAsync(AssistantBatch batch)
    {
        _batches[batch.Id] = batch;
        return Task.CompletedTask;
    }
}
