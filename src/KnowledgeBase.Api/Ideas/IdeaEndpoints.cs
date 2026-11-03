namespace KnowledgeBase.Api.Ideas;

// Title is optional: without one, the idea is titled with the first few words of its text.
public record SaveIdeaRequest(string? Title, string? Text);

public static class IdeaEndpoints
{
    private const int MaxTitleLength = 120;
    private const int MaxTextLength = 50000;
    private const int TitleWords = 6;

    public static void MapIdeaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/ideas", async (IIdeaStore store) => Results.Ok(await store.ListAsync()));

        app.MapGet("/ideas/{id:guid}", async (Guid id, IIdeaStore store) =>
            await store.GetAsync(id) is { } idea ? Results.Ok(idea) : Results.NotFound());

        app.MapPost("/ideas", async (SaveIdeaRequest request, IIdeaStore store) =>
        {
            var (title, text, error) = Read(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            var now = DateTimeOffset.UtcNow;
            var idea = new Idea(Guid.NewGuid(), title, text, now, now);
            await store.AddAsync(idea);
            return Results.Created($"/ideas/{idea.Id}", idea);
        });

        // Replaces the title and text; the date it was caught stays.
        app.MapPut("/ideas/{id:guid}", async (Guid id, SaveIdeaRequest request, IIdeaStore store) =>
        {
            if (await store.GetAsync(id) is not { } before)
                return Results.NotFound();
            var (title, text, error) = Read(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            var idea = before with { Title = title, Text = text, UpdatedAt = DateTimeOffset.UtcNow };
            await store.UpdateAsync(idea);
            return Results.Ok(idea);
        });

        app.MapDelete("/ideas/{id:guid}", async (Guid id, IIdeaStore store) =>
            await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());
    }

    // The text is kept exactly as typed, apart from blank lines at the end.
    private static (string Title, string Text, string? Error) Read(SaveIdeaRequest request)
    {
        var text = request.Text?.TrimEnd() ?? "";
        var title = string.IsNullOrWhiteSpace(request.Title) ? TitleFrom(text) : request.Title.Trim();
        if (title.Length == 0)
            return ("", "", "Write your idea, or give it a title.");
        if (title.Length > MaxTitleLength)
            return ("", "", $"The title can be up to {MaxTitleLength} characters.");
        if (text.Length > MaxTextLength)
            return ("", "", $"An idea can be up to {MaxTextLength} characters.");
        return (title, text, null);
    }

    // "so I was thinking we could put a slat wall…" → "So I was thinking we could…"
    private static string TitleFrom(string text)
    {
        var words = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0)
            return "";
        var title = string.Join(' ', words.Take(TitleWords)).TrimEnd('.', ',', ';', ':', '!', '?', '-');
        if (title.Length > MaxTitleLength)
            title = title[..MaxTitleLength].TrimEnd();
        title = char.ToUpper(title[0]) + title[1..];
        return words.Length > TitleWords ? title + "…" : title;
    }
}
