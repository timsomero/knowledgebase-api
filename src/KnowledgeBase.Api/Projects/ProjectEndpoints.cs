using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;

namespace KnowledgeBase.Api.Projects;

public record CreateProjectRequest(
    string? Name,
    string? Category,
    ProjectSize? Size,
    ProjectHealth? Health,
    DateOnly? TargetDate,
    string? Notes,
    string? Goal);

public record AddLogRequest(string? Text);

// Days: how far back the activity goes (1 to 90, two weeks when left out). ProjectIds: the projects to
// include; all of them when left out or empty. Today: the date on your device, for the report's date.
public record ReportRequest(int? Days, IReadOnlyList<Guid>? ProjectIds, DateOnly? Today);

public static class ProjectEndpoints
{
    private const int MaxNameLength = 100;
    private const int MaxNotesLength = 10000;
    private const int MaxGoalLength = 500;
    private const int MaxLogLength = 2000;

    private static readonly Dictionary<ProjectHealth, string> HealthNames = new()
    {
        [ProjectHealth.OnTrack] = "On track",
        [ProjectHealth.NeedsAttention] = "Needs attention",
        [ProjectHealth.Blocked] = "Blocked",
    };

    public static void MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/projects", async (IProjectStore store) => Results.Ok(await store.ListAsync()));

        app.MapGet("/projects/{id:guid}", async (Guid id, IProjectStore store) =>
            await store.GetAsync(id) is { } project ? Results.Ok(project) : Results.NotFound());

        // A new project counts as checked in now, and its log starts with "Project added".
        app.MapPost("/projects", async (CreateProjectRequest request, IProjectStore store) =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = new Project(
                Guid.NewGuid(),
                request.Name?.Trim() ?? "",
                request.Category?.Trim() ?? "",
                request.Size ?? ProjectSize.Medium,
                request.Health ?? ProjectHealth.OnTrack,
                request.TargetDate,
                NormalizeNotes(request.Notes),
                NormalizeGoal(request.Goal),
                [new ProjectLogEntry(Guid.NewGuid(), now, "Project added", Auto: true)],
                now,
                now,
                now);
            if (Validate(project) is { } error)
                return Results.BadRequest(new { error });

            await store.AddAsync(project);
            return Results.Created($"/projects/{project.Id}", project);
        });

        // Partial update: only the fields present in the body change; send null to clear targetDate,
        // notes or goal. A change of health is written to the log.
        app.MapPatch("/projects/{id:guid}", async (Guid id, JsonObject body, IProjectStore store, IOptions<JsonOptions> jsonOptions) =>
        {
            if (await store.GetAsync(id) is not { } before)
                return Results.NotFound();

            var project = before;
            var options = jsonOptions.Value.SerializerOptions;
            try
            {
                if (body.TryGetPropertyValue("name", out var name))
                    project = project with { Name = name?.Deserialize<string>(options)?.Trim() ?? "" };
                if (body.TryGetPropertyValue("category", out var category))
                    project = project with { Category = category?.Deserialize<string>(options)?.Trim() ?? "" };
                if (body.TryGetPropertyValue("size", out var size) && size is not null)
                    project = project with { Size = size.Deserialize<ProjectSize>(options) };
                if (body.TryGetPropertyValue("health", out var health) && health is not null)
                    project = project with { Health = health.Deserialize<ProjectHealth>(options) };
                if (body.TryGetPropertyValue("targetDate", out var targetDate))
                    project = project with { TargetDate = targetDate?.Deserialize<DateOnly>(options) };
                if (body.TryGetPropertyValue("notes", out var notes))
                    project = project with { Notes = NormalizeNotes(notes?.Deserialize<string>(options)) };
                if (body.TryGetPropertyValue("goal", out var goal))
                    project = project with { Goal = NormalizeGoal(goal?.Deserialize<string>(options)) };
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            if (Validate(project) is { } error)
                return Results.BadRequest(new { error });

            var now = DateTimeOffset.UtcNow;
            await store.UpdateAsync(project with { UpdatedAt = now });
            if (project.Health != before.Health)
                await store.AddLogAsync(id, new ProjectLogEntry(Guid.NewGuid(), now, $"Health: {HealthNames[before.Health]} → {HealthNames[project.Health]}", Auto: true));
            return await store.GetAsync(id) is { } saved ? Results.Ok(saved) : Results.NotFound();
        });

        // "Checked in": you looked at the project today, so the board stops fading it.
        app.MapPost("/projects/{id:guid}/checkin", async (Guid id, IProjectStore store) =>
        {
            if (await store.GetAsync(id) is not { } project)
                return Results.NotFound();

            var now = DateTimeOffset.UtcNow;
            await store.UpdateAsync(project with { LastCheckedIn = now, UpdatedAt = now });
            await store.AddLogAsync(id, new ProjectLogEntry(Guid.NewGuid(), now, "Checked in", Auto: true));
            return await store.GetAsync(id) is { } saved ? Results.Ok(saved) : Results.NotFound();
        });

        // Adds a line you wrote to the project's activity log.
        app.MapPost("/projects/{id:guid}/log", async (Guid id, AddLogRequest request, IProjectStore store) =>
        {
            var text = request.Text?.Trim() ?? "";
            if (text.Length == 0)
                return Results.BadRequest(new { error = "Write something to add to the log." });
            if (text.Length > MaxLogLength)
                return Results.BadRequest(new { error = $"Write up to {MaxLogLength} characters." });

            if (!await store.AddLogAsync(id, new ProjectLogEntry(Guid.NewGuid(), DateTimeOffset.UtcNow, text, Auto: false)))
                return Results.NotFound();
            return await store.GetAsync(id) is { } saved ? Results.Ok(saved) : Results.NotFound();
        });

        app.MapDelete("/projects/{id:guid}/log/{entryId:guid}", async (Guid id, Guid entryId, IProjectStore store) =>
        {
            if (await store.GetAsync(id) is not { } project || project.Log.All(e => e.Id != entryId))
                return Results.NotFound();
            await store.RemoveLogAsync(id, entryId);
            return await store.GetAsync(id) is { } saved ? Results.Ok(saved) : Results.NotFound();
        });

        // The leadership report, written by the assistant when there is one. Blocked projects come first,
        // then those needing attention, then the rest; bigger before smaller, as on the board.
        app.MapPost("/projects/report", async (ReportRequest request, IProjectStore store, IProjectReporter reporter, CancellationToken cancellationToken) =>
        {
            var days = request.Days ?? 14;
            if (days is < 1 or > 90)
                return Results.BadRequest(new { error = "Report on 1 to 90 days." });

            var all = await store.ListAsync();
            var chosen = request.ProjectIds is { Count: > 0 } ids ? all.Where(p => ids.Contains(p.Id)).ToList() : all.ToList();
            if (chosen.Count == 0)
                return Results.BadRequest(new { error = "Choose at least one project." });

            var ordered = chosen
                .OrderBy(p => p.Health switch { ProjectHealth.Blocked => 0, ProjectHealth.NeedsAttention => 1, _ => 2 })
                .ThenByDescending(p => p.Size)
                .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var report = await reporter.WriteAsync(ordered, request.Today ?? DateOnly.FromDateTime(DateTime.UtcNow), days, cancellationToken);
            return report is null
                ? Results.Json(new { error = "The assistant couldn't write the report just now. Try again in a minute." }, statusCode: 502)
                : Results.Ok(report);
        });

        app.MapDelete("/projects/{id:guid}", async (Guid id, IProjectStore store) =>
            await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());
    }

    private static string? Validate(Project project) =>
        project.Name.Length is 0 or > MaxNameLength ? $"Give the project a name of up to {MaxNameLength} characters."
        : project.Category.Length == 0 ? "Choose a work category."
        : project.Notes?.Length > MaxNotesLength ? $"Notes can be up to {MaxNotesLength} characters."
        : project.Goal?.Length > MaxGoalLength ? $"The goal can be up to {MaxGoalLength} characters."
        : !Enum.IsDefined(project.Size) || !Enum.IsDefined(project.Health) ? "Unknown size or health."
        : null;

    // Notes keep their line breaks; only blank notes become null.
    private static string? NormalizeNotes(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? null : notes.TrimEnd();

    private static string? NormalizeGoal(string? goal) =>
        string.IsNullOrWhiteSpace(goal) ? null : goal.Trim();
}
