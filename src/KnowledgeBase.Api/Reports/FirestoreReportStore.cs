using System.Globalization;
using Google.Cloud.Firestore;
using KnowledgeBase.Api.Projects;

namespace KnowledgeBase.Api.Reports;

// Stores saved reports in the "reports" collection; the document ID is the report's GUID. Each project's
// write-up is a map in the "projects" list, with its health stored by name and dates as "yyyy-MM-dd".
public class FirestoreReportStore(FirestoreDb db) : IReportStore
{
    private CollectionReference Reports => db.Collection("reports");

    public async Task<IReadOnlyList<SavedReport>> ListAsync()
    {
        var snapshot = await Reports.OrderByDescending("savedAt").GetSnapshotAsync();
        return snapshot.Documents.Select(ToReport).ToList();
    }

    public async Task<SavedReport?> GetAsync(Guid id)
    {
        var doc = await Reports.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToReport(doc) : null;
    }

    public Task AddAsync(SavedReport report) => Reports.Document(report.Id.ToString()).CreateAsync(new Dictionary<string, object?>
    {
        ["savedAt"] = Timestamp.FromDateTimeOffset(report.SavedAt),
        ["date"] = Day(report.Date),
        ["days"] = report.Days,
        ["summary"] = report.Summary,
        ["forYou"] = report.ForYou.ToList(),
        ["assisted"] = report.Assisted,
        ["projects"] = report.Projects.Select(p => new Dictionary<string, object?>
        {
            ["id"] = p.Id.ToString(),
            ["name"] = p.Name,
            ["category"] = p.Category,
            ["health"] = p.Health.ToString(),
            ["targetDate"] = p.TargetDate is { } target ? Day(target) : null,
            ["goal"] = p.Goal,
            ["goalSuggested"] = p.GoalSuggested,
            ["progress"] = p.Progress,
            ["next"] = p.Next,
        }).ToList(),
    });

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Reports.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    // In batches, since a Firestore batch takes at most 500 writes.
    public async Task<int> DeleteAllAsync()
    {
        var docs = (await Reports.GetSnapshotAsync()).Documents;
        foreach (var chunk in docs.Chunk(400))
        {
            var batch = db.StartBatch();
            foreach (var doc in chunk)
                batch.Delete(doc.Reference);
            await batch.CommitAsync();
        }
        return docs.Count;
    }

    private static string Day(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly ParseDay(string value) => DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static SavedReport ToReport(DocumentSnapshot doc)
    {
        doc.TryGetValue<List<string>?>("forYou", out var forYou);
        doc.TryGetValue<List<Dictionary<string, object?>>?>("projects", out var projects);

        return new SavedReport(
            Guid.Parse(doc.Id),
            doc.GetValue<Timestamp>("savedAt").ToDateTimeOffset(),
            ParseDay(doc.GetValue<string>("date")),
            doc.GetValue<int>("days"),
            doc.GetValue<string>("summary"),
            forYou ?? [],
            (projects ?? []).Select(p => new ProjectReportItem(
                Guid.Parse((string)p["id"]!),
                (string)p["name"]!,
                (string)p["category"]!,
                Enum.Parse<ProjectHealth>((string)p["health"]!),
                p.GetValueOrDefault("targetDate") is string target ? ParseDay(target) : null,
                p.GetValueOrDefault("goal") as string ?? "",
                p.GetValueOrDefault("goalSuggested") is true,
                p.GetValueOrDefault("progress") as string ?? "",
                p.GetValueOrDefault("next") as string ?? "")).ToList(),
            doc.GetValue<bool>("assisted"));
    }
}
