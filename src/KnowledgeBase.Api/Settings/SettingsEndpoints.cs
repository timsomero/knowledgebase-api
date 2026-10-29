namespace KnowledgeBase.Api.Settings;

// A field left out (or null) keeps what is saved.
public record SaveSettingsRequest(IReadOnlyList<string>? WorkCategories, IReadOnlyList<string>? Team);

public static class SettingsEndpoints
{
    private const int MaxNameLength = 60;

    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/settings", async (ISettingsStore store) => Results.Ok(await store.GetAsync()));

        // Replaces the settings sent; the web app saves after every change. Removing a work category keeps
        // it on the tasks already in it, and removing a team member keeps them on their projects.
        app.MapPut("/settings", async (SaveSettingsRequest request, ISettingsStore store) =>
        {
            var current = await store.GetAsync();
            var categories = new List<string>();
            foreach (var c in request.WorkCategories ?? current.WorkCategories)
            {
                var name = c?.Trim();
                if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
                    return Results.BadRequest(new { error = $"Category names must be 1–{MaxNameLength} characters." });
                if (categories.Contains(name, StringComparer.OrdinalIgnoreCase))
                    return Results.BadRequest(new { error = $"There is already a category called \"{name}\"." });
                categories.Add(name);
            }

            if (categories.Count == 0)
                return Results.BadRequest(new { error = "Keep at least one work category." });

            var team = current.Team;
            if (request.Team is not null)
            {
                var names = new List<string>();
                foreach (var t in request.Team)
                {
                    var name = t?.Trim();
                    if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
                        return Results.BadRequest(new { error = $"Names must be 1–{MaxNameLength} characters." });
                    // "You" is always on the board, so it isn't stored.
                    if (!name.Equals("You", StringComparison.OrdinalIgnoreCase) && !names.Contains(name, StringComparer.OrdinalIgnoreCase))
                        names.Add(name);
                }
                team = names;
            }

            var settings = new AppSettings(categories, team);
            await store.SaveAsync(settings);
            return Results.Ok(settings);
        });
    }
}
