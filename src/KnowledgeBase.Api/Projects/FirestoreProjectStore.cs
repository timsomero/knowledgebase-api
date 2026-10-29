using System.Globalization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Projects;

// Stores projects in the "projects" collection; the document ID is the project's GUID.
// Enums are stored as their names and the target date as "yyyy-MM-dd".
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

    public Task AddAsync(Project project) => Projects.Document(project.Id.ToString()).CreateAsync(ToFields(project));

    public Task UpdateAsync(Project project) => Projects.Document(project.Id.ToString()).SetAsync(ToFields(project));

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
        ["people"] = project.People.ToList(),
        ["size"] = project.Size.ToString(),
        ["health"] = project.Health.ToString(),
        ["targetDate"] = project.TargetDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ["lastCheckedIn"] = Timestamp.FromDateTimeOffset(project.LastCheckedIn),
        ["createdAt"] = Timestamp.FromDateTimeOffset(project.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(project.UpdatedAt),
    };

    private static Project ToProject(DocumentSnapshot doc)
    {
        doc.TryGetValue<List<string>?>("people", out var people);
        doc.TryGetValue<string?>("targetDate", out var targetDate);

        return new Project(
            Guid.Parse(doc.Id),
            doc.GetValue<string>("name"),
            doc.GetValue<string>("category"),
            people ?? [],
            Enum.Parse<ProjectSize>(doc.GetValue<string>("size")),
            Enum.Parse<ProjectHealth>(doc.GetValue<string>("health")),
            targetDate is null ? null : DateOnly.ParseExact(targetDate, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            doc.GetValue<Timestamp>("lastCheckedIn").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset());
    }
}
