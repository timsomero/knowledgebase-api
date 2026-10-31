using System.Collections.Concurrent;
using KnowledgeBase.Api.Projects;

namespace KnowledgeBase.Api.Reports;

// A leadership report you saved, as it was on the day (with your edits), so reports can be compared over
// time. Projects keep the health, dates and names they had then. ForYou holds the notes that were only for
// you; they are kept with the report but never copied out with it.
public record SavedReport(
    Guid Id,
    DateTimeOffset SavedAt,
    DateOnly Date,
    int Days,
    string Summary,
    IReadOnlyList<string> ForYou,
    IReadOnlyList<ProjectReportItem> Projects,
    bool Assisted);

public interface IReportStore
{
    // Newest first.
    Task<IReadOnlyList<SavedReport>> ListAsync();
    Task<SavedReport?> GetAsync(Guid id);
    Task AddAsync(SavedReport report);
    // False when the report doesn't exist.
    Task<bool> DeleteAsync(Guid id);
    // How many were deleted.
    Task<int> DeleteAllAsync();
}

// Used for local development; data is lost when the process stops.
public class InMemoryReportStore : IReportStore
{
    private readonly ConcurrentDictionary<Guid, SavedReport> _reports = new();

    public Task<IReadOnlyList<SavedReport>> ListAsync() =>
        Task.FromResult<IReadOnlyList<SavedReport>>(_reports.Values.OrderByDescending(r => r.SavedAt).ToList());

    public Task<SavedReport?> GetAsync(Guid id) =>
        Task.FromResult(_reports.TryGetValue(id, out var report) ? report : null);

    public Task AddAsync(SavedReport report)
    {
        _reports[report.Id] = report;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_reports.TryRemove(id, out _));

    public Task<int> DeleteAllAsync()
    {
        var count = _reports.Count;
        _reports.Clear();
        return Task.FromResult(count);
    }
}
