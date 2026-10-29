using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;

namespace KnowledgeBase.Api.Projects;

public record CreateProjectRequest(
    string? Name,
    string? Category,
    IReadOnlyList<string>? People,
    ProjectSize? Size,
    ProjectHealth? Health,
    DateOnly? TargetDate);

public static class ProjectEndpoints
{
    private const int MaxNameLength = 100;

    public static void MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/projects", async (IProjectStore store) => Results.Ok(await store.ListAsync()));

        app.MapGet("/projects/{id:guid}", async (Guid id, IProjectStore store) =>
            await store.GetAsync(id) is { } project ? Results.Ok(project) : Results.NotFound());

        // A new project counts as checked in now.
        app.MapPost("/projects", async (CreateProjectRequest request, IProjectStore store) =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = new Project(
                Guid.NewGuid(),
                request.Name?.Trim() ?? "",
                request.Category?.Trim() ?? "",
                NormalizePeople(request.People),
                request.Size ?? ProjectSize.Medium,
                request.Health ?? ProjectHealth.OnTrack,
                request.TargetDate,
                now,
                now,
                now);
            if (Validate(project) is { } error)
                return Results.BadRequest(new { error });

            await store.AddAsync(project);
            return Results.Created($"/projects/{project.Id}", project);
        });

        // Partial update: only the fields present in the body change; send null to clear targetDate.
        app.MapPatch("/projects/{id:guid}", async (Guid id, JsonObject body, IProjectStore store, IOptions<JsonOptions> jsonOptions) =>
        {
            if (await store.GetAsync(id) is not { } project)
                return Results.NotFound();

            var options = jsonOptions.Value.SerializerOptions;
            try
            {
                if (body.TryGetPropertyValue("name", out var name))
                    project = project with { Name = name?.Deserialize<string>(options)?.Trim() ?? "" };
                if (body.TryGetPropertyValue("category", out var category))
                    project = project with { Category = category?.Deserialize<string>(options)?.Trim() ?? "" };
                if (body.TryGetPropertyValue("people", out var people))
                    project = project with { People = NormalizePeople(people?.Deserialize<List<string>>(options)) };
                if (body.TryGetPropertyValue("size", out var size) && size is not null)
                    project = project with { Size = size.Deserialize<ProjectSize>(options) };
                if (body.TryGetPropertyValue("health", out var health) && health is not null)
                    project = project with { Health = health.Deserialize<ProjectHealth>(options) };
                if (body.TryGetPropertyValue("targetDate", out var targetDate))
                    project = project with { TargetDate = targetDate?.Deserialize<DateOnly>(options) };
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            if (Validate(project) is { } error)
                return Results.BadRequest(new { error });

            project = project with { UpdatedAt = DateTimeOffset.UtcNow };
            await store.UpdateAsync(project);
            return Results.Ok(project);
        });

        // "Checked in": you looked at the project today, so the board stops fading it.
        app.MapPost("/projects/{id:guid}/checkin", async (Guid id, IProjectStore store) =>
        {
            if (await store.GetAsync(id) is not { } project)
                return Results.NotFound();

            var now = DateTimeOffset.UtcNow;
            project = project with { LastCheckedIn = now, UpdatedAt = now };
            await store.UpdateAsync(project);
            return Results.Ok(project);
        });

        app.MapDelete("/projects/{id:guid}", async (Guid id, IProjectStore store) =>
            await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());
    }

    private static string? Validate(Project project) =>
        project.Name.Length is 0 or > MaxNameLength ? $"Give the project a name of up to {MaxNameLength} characters."
        : project.Category.Length == 0 ? "Choose a work category."
        : project.People.Count == 0 ? "Pick who's carrying it."
        : !Enum.IsDefined(project.Size) || !Enum.IsDefined(project.Health) ? "Unknown size or health."
        : null;

    private static IReadOnlyList<string> NormalizePeople(IEnumerable<string>? people) =>
        (people ?? [])
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
