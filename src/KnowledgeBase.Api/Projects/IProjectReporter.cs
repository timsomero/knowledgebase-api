namespace KnowledgeBase.Api.Projects;

// The leadership report on the chosen projects, covering the last Days days. Summary and each project's
// Goal, Progress and Next are written to share; ForYou holds notes for you only (a health that doesn't
// match the notes, a project not checked in lately, what was left out) and never goes in the report.
// Assisted is false when no assistant wrote it, so the text is your own and needs a closer look.
public record ProjectReport(
    DateOnly Date,
    int Days,
    string Summary,
    IReadOnlyList<string> ForYou,
    IReadOnlyList<ProjectReportItem> Projects,
    bool Assisted);

// GoalSuggested: the project has no goal, so the assistant suggested one from its notes.
public record ProjectReportItem(
    Guid Id,
    string Name,
    string Category,
    ProjectHealth Health,
    DateOnly? TargetDate,
    string Goal,
    bool GoalSuggested,
    string Progress,
    string Next);

public interface IProjectReporter
{
    // Null when the assistant can't be reached or gives no usable answer. The projects come in the
    // order they appear in the report.
    Task<ProjectReport?> WriteAsync(IReadOnlyList<Project> projects, DateOnly today, int days, CancellationToken cancellationToken);
}

// Used without ANTHROPIC_API_KEY (local runs, or before the key is set): the report is put together from
// the projects as typed, with nothing rewritten or left out.
public class PlainProjectReporter : IProjectReporter
{
    public Task<ProjectReport?> WriteAsync(IReadOnlyList<Project> projects, DateOnly today, int days, CancellationToken cancellationToken)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-days);
        var items = projects.Select(p =>
        {
            var updates = p.Log.Where(e => !e.Auto && e.At >= since).Select(e => e.Text.Trim().TrimEnd('.') + ".").ToList();
            return new ProjectReportItem(p.Id, p.Name, p.Category, p.Health, p.TargetDate, p.Goal ?? "", GoalSuggested: false,
                updates.Count == 0 ? "No updates in this period." : string.Join(" ", updates), Next: "");
        }).ToList();

        var counts = string.Join(", ", new[]
        {
            (ProjectHealth.OnTrack, "on track"),
            (ProjectHealth.NeedsAttention, projects.Count(p => p.Health == ProjectHealth.NeedsAttention) == 1 ? "needs attention" : "need attention"),
            (ProjectHealth.Blocked, "blocked"),
        }.Select(h => (Count: projects.Count(p => p.Health == h.Item1), Label: h.Item2)).Where(h => h.Count > 0).Select(h => $"{h.Count} {h.Label}"));
        var summary = $"{projects.Count} {(projects.Count == 1 ? "project" : "projects")}: {counts}.";

        var forYou = new List<string> { "Written without the assistant: your notes appear as typed, so read them before sharing." };
        foreach (var p in projects)
        {
            var quiet = (int)(DateTimeOffset.UtcNow - p.LastCheckedIn).TotalDays;
            if (quiet >= 14)
                forYou.Add($"{p.Name} hasn't been checked in for {quiet} days.");
            if (p.Goal is null)
                forYou.Add($"{p.Name} has no goal yet; add one on its page.");
        }

        return Task.FromResult<ProjectReport?>(new ProjectReport(today, days, summary, forYou, items, Assisted: false));
    }
}
