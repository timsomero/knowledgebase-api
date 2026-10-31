using System.Globalization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Projects;

// Stores projects in the "projects" collection; the document ID is the project's GUID.
// Enums are stored as their names and the target date as "yyyy-MM-dd". The activity log is a list
// field on the project, changed only in transactions.
public class FirestoreProjectStore(FirestoreDb db) : IProjectStore
{
    private CollectionReference Projects => db.Collection("projects");

    public async Task<IReadOnlyList<Project>> ListAsync()
    {
        var snapshot = await Projects.OrderBy("createdAt").GetSnapshotAsync();
        return snapshot.Documents.Select(ToProject).ToList();
    }

    public async Task<Project?> GetAsync(Guid id)
    {
        var doc = await Projects.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToProject(doc) : null;
    }

    public Task AddAsync(Project project)
    {
        var fields = ToFields(project);
        fields["log"] = project.Log.Select(ToFields).ToList();
        return Projects.Document(project.Id.ToString()).CreateAsync(fields);
    }

    // Merging leaves the "log" field as it is.
    public Task UpdateAsync(Project project) => Projects.Document(project.Id.ToString()).SetAsync(ToFields(project), SetOptions.MergeAll);

    public Task<bool> AddLogAsync(Guid projectId, ProjectLogEntry entry) =>
        ChangeLogAsync(projectId, log => [.. log, entry]);

    public Task<bool> RemoveLogAsync(Guid projectId, Guid entryId) =>
        ChangeLogAsync(projectId, log => log.Where(e => e.Id != entryId).ToList());

    private Task<bool> ChangeLogAsync(Guid projectId, Func<IReadOnlyList<ProjectLogEntry>, IReadOnlyList<ProjectLogEntry>> change) =>
        db.RunTransactionAsync(async transaction =>
        {
            var doc = Projects.Document(projectId.ToString());
            var snapshot = await transaction.GetSnapshotAsync(doc);
            if (!snapshot.Exists)
                return false;
            transaction.Update(doc, "log", change(ToLog(snapshot)).Select(ToFields).ToList());
            return true;
        });

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Projects.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Dictionary<string, object?> ToFields(Project project) => new()
    {
        ["name"] = project.Name,
        ["category"] = project.Category,
        ["size"] = project.Size.ToString(),
        ["health"] = project.Health.ToString(),
        ["targetDate"] = project.TargetDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ["notes"] = project.Notes,
        ["goal"] = project.Goal,
        ["lastCheckedIn"] = Timestamp.FromDateTimeOffset(project.LastCheckedIn),
        ["createdAt"] = Timestamp.FromDateTimeOffset(project.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(project.UpdatedAt),
    };

    private static Dictionary<string, object> ToFields(ProjectLogEntry entry) => new()
    {
        ["id"] = entry.Id.ToString(),
        ["at"] = Timestamp.FromDateTimeOffset(entry.At),
        ["text"] = entry.Text,
        ["auto"] = entry.Auto,
    };

    private static List<ProjectLogEntry> ToLog(DocumentSnapshot doc) =>
        doc.TryGetValue<List<Dictionary<string, object>>?>("log", out var log) && log is not null
            ? log.Select(e => new ProjectLogEntry(
                Guid.Parse((string)e["id"]),
                ((Timestamp)e["at"]).ToDateTimeOffset(),
                (string)e["text"],
                (bool)e["auto"])).ToList()
            : [];

    private static Project ToProject(DocumentSnapshot doc)
    {
        doc.TryGetValue<string?>("targetDate", out var targetDate);
        doc.TryGetValue<string?>("notes", out var notes);
        doc.TryGetValue<string?>("goal", out var goal);

        return new Project(
            Guid.Parse(doc.Id),
            doc.GetValue<string>("name"),
            doc.GetValue<string>("category"),
            Enum.Parse<ProjectSize>(doc.GetValue<string>("size")),
            Enum.Parse<ProjectHealth>(doc.GetValue<string>("health")),
            targetDate is null ? null : DateOnly.ParseExact(targetDate, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            notes,
            goal,
            ToLog(doc),
            doc.GetValue<Timestamp>("lastCheckedIn").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset());
    }
}
