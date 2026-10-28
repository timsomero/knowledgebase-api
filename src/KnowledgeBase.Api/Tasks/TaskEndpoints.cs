using System.Text.Json;
using System.Text.Json.Nodes;
using KnowledgeBase.Api.Photos;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;

namespace KnowledgeBase.Api.Tasks;

public record CreateTaskRequest(
    string Title,
    string? Notes,
    TaskPriority? Priority,
    DateOnly? DueDate,
    IReadOnlyList<string>? Tags,
    string? DelegatedTo,
    TaskArea? Area,
    string? Category);

// Status is "tidied", "unavailable" (the assistant couldn't be reached; the task stays as typed)
// or "skipped" (the task was edited or finished in the meantime, or there is no assistant).
public record TidyResult(TaskItem Task, string Status);

public static class TaskEndpoints
{
    private const int MaxTitleLength = 200;

    public static void MapTaskEndpoints(this IEndpointRouteBuilder app)
    {
        // Optional filters: ?status=todo|in_progress|done  &tag=work
        // Order: unfinished first, then by due date, oldest (most overdue) first and none last, then
        // priority (high first), then oldest first.
        app.MapGet("/tasks", async (string? status, string? tag, ITaskStore store) =>
        {
            TaskState? state = null;
            if (status is not null)
            {
                if (!TryParseState(status, out var parsed))
                    return Results.BadRequest(new { error = "status must be todo, in_progress or done." });
                state = parsed;
            }

            var tasks = (await store.ListAsync())
                .Where(t => state is null || t.Status == state)
                .Where(t => tag is null || t.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase))
                .OrderBy(t => t.Status == TaskState.Done)
                .ThenBy(t => t.DueDate ?? DateOnly.MaxValue)
                .ThenByDescending(t => t.Priority)
                .ThenBy(t => t.CreatedAt);

            return Results.Ok(tasks);
        });

        app.MapGet("/tasks/{id:guid}", async (Guid id, ITaskStore store) =>
            await store.GetAsync(id) is { } task ? Results.Ok(task) : Results.NotFound());

        app.MapPost("/tasks", async (CreateTaskRequest request, ITaskStore store) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
                return Results.BadRequest(new { error = "Title is required." });
            var area = request.Area ?? TaskArea.Personal;
            var category = area == TaskArea.Work ? NormalizeName(request.Category) : null;
            if (area == TaskArea.Work && category is null)
                return Results.BadRequest(new { error = "Choose a category for a work task." });

            var now = DateTimeOffset.UtcNow;
            var task = new TaskItem(
                Guid.NewGuid(),
                request.Title.Trim(),
                NormalizeNotes(request.Notes),
                TaskState.Todo,
                request.Priority ?? TaskPriority.Normal,
                request.DueDate,
                NormalizeTags(request.Tags),
                NormalizeName(request.DelegatedTo),
                area,
                category,
                now,
                now,
                null,
                []);

            await store.AddAsync(task);
            return Results.Created($"/tasks/{task.Id}", task);
        });

        // Partial update: only the fields present in the body change; send null to clear notes, dueDate,
        // delegatedTo or category. Moving a task to the personal area clears its category.
        app.MapPatch("/tasks/{id:guid}", async (Guid id, JsonObject body, ITaskStore store, IOptions<JsonOptions> jsonOptions) =>
        {
            if (await store.GetAsync(id) is not { } task)
                return Results.NotFound();

            var options = jsonOptions.Value.SerializerOptions;
            try
            {
                if (body.TryGetPropertyValue("title", out var title))
                {
                    var value = title?.Deserialize<string>(options);
                    if (string.IsNullOrWhiteSpace(value))
                        return Results.BadRequest(new { error = "Title cannot be empty." });
                    task = task with { Title = value.Trim() };
                }

                if (body.TryGetPropertyValue("notes", out var notes))
                    task = task with { Notes = NormalizeNotes(notes?.Deserialize<string>(options)) };

                if (body.TryGetPropertyValue("priority", out var priority))
                    task = task with { Priority = priority?.Deserialize<TaskPriority>(options) ?? TaskPriority.Normal };

                if (body.TryGetPropertyValue("dueDate", out var dueDate))
                    task = task with { DueDate = dueDate?.Deserialize<DateOnly>(options) };

                if (body.TryGetPropertyValue("tags", out var tags))
                    task = task with { Tags = NormalizeTags(tags?.Deserialize<List<string>>(options)) };

                if (body.TryGetPropertyValue("delegatedTo", out var delegatedTo))
                    task = task with { DelegatedTo = NormalizeName(delegatedTo?.Deserialize<string>(options)) };

                if (body.TryGetPropertyValue("area", out var area))
                    task = task with { Area = area?.Deserialize<TaskArea>(options) ?? TaskArea.Personal };

                if (body.TryGetPropertyValue("category", out var category))
                    task = task with { Category = NormalizeName(category?.Deserialize<string>(options)) };

                if (task.Area == TaskArea.Personal)
                    task = task with { Category = null };

                if (body.TryGetPropertyValue("status", out var status))
                {
                    if (status is null)
                        return Results.BadRequest(new { error = "status must be todo, in_progress or done." });

                    var newState = status.Deserialize<TaskState>(options);
                    if (newState != task.Status)
                        task = task with
                        {
                            Status = newState,
                            CompletedAt = newState == TaskState.Done ? DateTimeOffset.UtcNow : null,
                        };
                }
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            task = task with { UpdatedAt = DateTimeOffset.UtcNow };
            await store.UpdateAsync(task);
            return Results.Ok(task);
        });

        // Tidies up a task that was saved as typed: the assistant rewrites the title and fills in notes,
        // due date, priority, tags and who it's delegated to. Only fields still empty are filled (priority
        // counts as empty while it is normal), tags and people come only from those already on tasks, and a
        // task changed while the assistant was working is left alone. ?today=yyyy-MM-dd is the user's local date, for "tomorrow" and weekdays.
        app.MapPost("/tasks/{id:guid}/tidy", async (Guid id, DateOnly? today, ITaskStore store, ITaskAssistant assistant) =>
        {
            if (await store.GetAsync(id) is not { } before)
                return Results.NotFound();
            if (!assistant.Enabled || before.Status == TaskState.Done)
                return Results.Ok(new TidyResult(before, "skipped"));

            var all = await store.ListAsync();
            var knownTags = all.SelectMany(t => t.Tags)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var knownPeople = all.Select(t => t.DelegatedTo).OfType<string>()
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Not tied to the request: the tidy-up finishes even if the app is closed meanwhile.
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var day = today ?? DateOnly.FromDateTime(DateTime.UtcNow);
            if (await assistant.SuggestAsync(before.Title, day, knownTags, knownPeople, timeout.Token) is not { } suggestion)
                return Results.Ok(new TidyResult(before, "unavailable"));

            if (await store.GetAsync(id) is not { } current)
                return Results.NotFound();
            if (current.UpdatedAt != before.UpdatedAt)
                return Results.Ok(new TidyResult(current, "skipped"));

            var task = current with
            {
                Title = suggestion.Title.Length > MaxTitleLength ? suggestion.Title[..MaxTitleLength] : suggestion.Title,
                Notes = current.Notes ?? NormalizeNotes(suggestion.Notes),
                DueDate = current.DueDate ?? suggestion.DueDate,
                Priority = current.Priority == TaskPriority.Normal ? suggestion.Priority ?? TaskPriority.Normal : current.Priority,
                Tags = current.Tags.Count > 0 ? current.Tags : NormalizeTags(suggestion.Tags),
                DelegatedTo = current.DelegatedTo ?? suggestion.DelegatedTo,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            await store.UpdateAsync(task);
            return Results.Ok(new TidyResult(task, "tidied"));
        });

        // Deletes the task's photos too.
        app.MapDelete("/tasks/{id:guid}", async (Guid id, ITaskStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } task || !await store.DeleteAsync(id))
                return Results.NotFound();
            await TaskPhotoEndpoints.DeletePhotosAsync(photos, task);
            return Results.NoContent();
        });
    }

    private static bool TryParseState(string value, out TaskState state) =>
        Enum.TryParse(value.Replace("_", ""), ignoreCase: true, out state) && Enum.IsDefined(state);

    private static string? NormalizeNotes(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();

    private static string? NormalizeName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : name.Trim();

    private static IReadOnlyList<string> NormalizeTags(IEnumerable<string>? tags) =>
        (tags ?? [])
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
