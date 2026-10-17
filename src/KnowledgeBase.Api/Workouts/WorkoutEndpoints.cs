namespace KnowledgeBase.Api.Workouts;

public record SaveWorkoutRequest(
    DateOnly? Date,
    string? CategoryId,
    string? Activity,
    IReadOnlyList<string>? Items,
    int? DurationMinutes,
    string? Notes);

// Id is null for a category added on the Config page; the server assigns one.
public record SaveCategoryRequest(string? Id, string? Name, WorkoutKind? Kind, IReadOnlyList<string>? Items);

public record SaveWorkoutConfigRequest(IReadOnlyList<SaveCategoryRequest>? Categories);

public static class WorkoutEndpoints
{
    private const int MaxNameLength = 60;
    private const int MaxNotesLength = 2000;

    public static void MapWorkoutEndpoints(this IEndpointRouteBuilder app)
    {
        // Newest first. Optional ?from=yyyy-MM-dd&to=yyyy-MM-dd (inclusive) and ?limit=N.
        app.MapGet("/workouts", async (DateOnly? from, DateOnly? to, int? limit, IWorkoutStore store) =>
        {
            IEnumerable<Workout> workouts = (await store.ListAsync())
                .Where(w => from is null || w.Date >= from)
                .Where(w => to is null || w.Date <= to)
                .OrderByDescending(w => w.Date)
                .ThenByDescending(w => w.CreatedAt);
            if (limit is > 0)
                workouts = workouts.Take(limit.Value);
            return Results.Ok(workouts);
        });

        app.MapGet("/workouts/{id:guid}", async (Guid id, IWorkoutStore store) =>
            await store.GetAsync(id) is { } workout ? Results.Ok(workout) : Results.NotFound());

        app.MapPost("/workouts", async (SaveWorkoutRequest request, IWorkoutStore store, IWorkoutConfigStore configs) =>
        {
            var category = (await configs.GetAsync()).Categories.FirstOrDefault(c => c.Id == request.CategoryId);
            if (category is null)
                return Results.BadRequest(new { error = "Pick a category." });

            if (Validate(request, category.Kind) is { } error)
                return Results.BadRequest(new { error });

            var now = DateTimeOffset.UtcNow;
            var workout = Build(Guid.NewGuid(), request, category.Id, category.Name, category.Kind, now, now);
            await store.AddAsync(workout);
            return Results.Created($"/workouts/{workout.Id}", workout);
        });

        // Replaces the whole workout (the edit screen sends every field).
        app.MapPut("/workouts/{id:guid}", async (Guid id, SaveWorkoutRequest request, IWorkoutStore store, IWorkoutConfigStore configs) =>
        {
            if (await store.GetAsync(id) is not { } existing)
                return Results.NotFound();

            // A category removed from Config since this workout was logged can still be kept as it was.
            var category = (await configs.GetAsync()).Categories.FirstOrDefault(c => c.Id == request.CategoryId);
            var (categoryId, categoryName, kind) = category is not null
                ? (category.Id, category.Name, category.Kind)
                : request.CategoryId == existing.CategoryId
                    ? (existing.CategoryId, existing.CategoryName, existing.Kind)
                    : default;
            if (categoryId is null)
                return Results.BadRequest(new { error = "Pick a category." });

            if (Validate(request, kind) is { } error)
                return Results.BadRequest(new { error });

            var workout = Build(id, request, categoryId, categoryName!, kind, existing.CreatedAt, DateTimeOffset.UtcNow);
            await store.UpdateAsync(workout);
            return Results.Ok(workout);
        });

        app.MapDelete("/workouts/{id:guid}", async (Guid id, IWorkoutStore store) =>
            await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        app.MapGet("/workout-config", async (IWorkoutConfigStore configs) => Results.Ok(await configs.GetAsync()));

        // Replaces the whole Config page; the web app saves after every change.
        app.MapPut("/workout-config", async (SaveWorkoutConfigRequest request, IWorkoutConfigStore configs) =>
        {
            var categories = new List<WorkoutCategory>();
            foreach (var c in request.Categories ?? [])
            {
                var name = c.Name?.Trim();
                if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
                    return Results.BadRequest(new { error = $"Category names must be 1–{MaxNameLength} characters." });
                if (categories.Any(x => x.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
                    return Results.BadRequest(new { error = $"There is already a category called \"{name}\"." });
                if (c.Kind is not { } kind || !Enum.IsDefined(kind))
                    return Results.BadRequest(new { error = $"Choose how \"{name}\" is logged." });

                var items = CleanList(c.Items);
                if (items.Any(i => i.Length > MaxNameLength))
                    return Results.BadRequest(new { error = $"Names must be at most {MaxNameLength} characters." });

                var id = string.IsNullOrWhiteSpace(c.Id) ? Guid.NewGuid().ToString("N") : c.Id.Trim();
                if (categories.Any(x => x.Id == id))
                    return Results.BadRequest(new { error = "Duplicate category id." });

                categories.Add(new WorkoutCategory(id, name, kind, items));
            }

            if (categories.Count == 0)
                return Results.BadRequest(new { error = "Keep at least one category." });

            var config = new WorkoutConfig(categories);
            await configs.SaveAsync(config);
            return Results.Ok(config);
        });
    }

    private static string? Validate(SaveWorkoutRequest request, WorkoutKind kind)
    {
        if (request.Date is null)
            return "Pick a date.";
        if (request.Notes?.Length > MaxNotesLength)
            return $"Notes must be at most {MaxNotesLength} characters.";

        if (kind == WorkoutKind.Activity)
        {
            if (string.IsNullOrWhiteSpace(request.Activity))
                return "Pick an activity.";
            if (request.DurationMinutes is not (>= 1 and <= 1440))
                return "Duration must be between 1 and 1440 minutes.";
        }
        else if (CleanList(request.Items).Count == 0)
        {
            return "Pick at least one.";
        }

        return null;
    }

    // Only the fields that belong to the category's kind are kept.
    private static Workout Build(
        Guid id, SaveWorkoutRequest r, string categoryId, string categoryName, WorkoutKind kind,
        DateTimeOffset createdAt, DateTimeOffset updatedAt) => new(
        id,
        r.Date!.Value,
        categoryId,
        categoryName,
        kind,
        kind == WorkoutKind.Activity ? r.Activity!.Trim() : null,
        kind == WorkoutKind.Checklist ? CleanList(r.Items) : [],
        kind == WorkoutKind.Activity ? r.DurationMinutes : null,
        string.IsNullOrWhiteSpace(r.Notes) ? null : r.Notes.Trim(),
        createdAt,
        updatedAt);

    private static IReadOnlyList<string> CleanList(IEnumerable<string>? values) =>
        (values ?? [])
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
