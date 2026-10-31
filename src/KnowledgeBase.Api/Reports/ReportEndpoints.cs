using KnowledgeBase.Api.Projects;

namespace KnowledgeBase.Api.Reports;

// The report as shown when you tapped Save, with your edits.
public record SaveReportRequest(
    DateOnly? Date,
    int? Days,
    string? Summary,
    IReadOnlyList<string>? ForYou,
    IReadOnlyList<ProjectReportItem>? Projects,
    bool? Assisted);

public static class ReportEndpoints
{
    private const int MaxTextLength = 5000;
    private const int MaxProjects = 200;

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/reports", async (IReportStore store) => Results.Ok(await store.ListAsync()));

        app.MapGet("/reports/{id:guid}", async (Guid id, IReportStore store) =>
            await store.GetAsync(id) is { } report ? Results.Ok(report) : Results.NotFound());

        app.MapPost("/reports", async (SaveReportRequest request, IReportStore store) =>
        {
            var projects = request.Projects ?? [];
            var forYou = (request.ForYou ?? []).Select(n => n.Trim()).Where(n => n.Length > 0).ToList();
            var texts = projects.SelectMany(p => new[] { p.Name, p.Category, p.Goal, p.Progress, p.Next }).Concat(forYou).Append(request.Summary ?? "");
            if (request.Date is null || request.Days is null or < 1 or > 90 || string.IsNullOrWhiteSpace(request.Summary))
                return Results.BadRequest(new { error = "A report needs its date, period and summary." });
            if (projects.Count is 0 or > MaxProjects)
                return Results.BadRequest(new { error = "A report needs at least one project." });
            if (texts.Any(t => t?.Length > MaxTextLength) || projects.Any(p => string.IsNullOrWhiteSpace(p.Name) || !Enum.IsDefined(p.Health)))
                return Results.BadRequest(new { error = $"Each part of the report can be up to {MaxTextLength} characters, and every project needs a name." });

            var report = new SavedReport(
                Guid.NewGuid(),
                DateTimeOffset.UtcNow,
                request.Date.Value,
                request.Days.Value,
                request.Summary.Trim(),
                forYou,
                projects.Select(p => p with
                {
                    Name = p.Name.Trim(),
                    Category = p.Category?.Trim() ?? "",
                    Goal = p.Goal?.Trim() ?? "",
                    Progress = p.Progress?.Trim() ?? "",
                    Next = p.Next?.Trim() ?? "",
                }).ToList(),
                request.Assisted ?? false);
            await store.AddAsync(report);
            return Results.Created($"/reports/{report.Id}", report);
        });

        app.MapDelete("/reports/{id:guid}", async (Guid id, IReportStore store) =>
            await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        // Deletes every saved report.
        app.MapDelete("/reports", async (IReportStore store) => Results.Ok(new { deleted = await store.DeleteAllAsync() }));
    }
}
