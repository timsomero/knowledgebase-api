using System.Globalization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Tasks;

// Stores tasks in the "tasks" collection; the document ID is the task's GUID.
// Enums are stored as their names and the due date as "yyyy-MM-dd" (Firestore has no date-only type).
public class FirestoreTaskStore(FirestoreDb db) : ITaskStore
{
    private CollectionReference Tasks => db.Collection("tasks");

    public async Task<IReadOnlyList<TaskItem>> ListAsync()
    {
        var snapshot = await Tasks.OrderBy("createdAt").GetSnapshotAsync();
        return snapshot.Documents.Select(ToTask).ToList();
    }

    public async Task<TaskItem?> GetAsync(Guid id)
    {
        var doc = await Tasks.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToTask(doc) : null;
    }

    public Task AddAsync(TaskItem task) => Tasks.Document(task.Id.ToString()).CreateAsync(ToFields(task));

    public Task UpdateAsync(TaskItem task) => Tasks.Document(task.Id.ToString()).SetAsync(ToFields(task));

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Tasks.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Dictionary<string, object?> ToFields(TaskItem task) => new()
    {
        ["title"] = task.Title,
        ["notes"] = task.Notes,
        ["status"] = task.Status.ToString(),
        ["priority"] = task.Priority.ToString(),
        ["dueDate"] = task.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ["tags"] = task.Tags.ToList(),
        ["createdAt"] = Timestamp.FromDateTimeOffset(task.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(task.UpdatedAt),
        ["completedAt"] = task.CompletedAt is { } c ? Timestamp.FromDateTimeOffset(c) : null,
    };

    private static TaskItem ToTask(DocumentSnapshot doc)
    {
        doc.TryGetValue<string?>("notes", out var notes);
        doc.TryGetValue<string?>("dueDate", out var dueDate);
        doc.TryGetValue<List<string>?>("tags", out var tags);
        doc.TryGetValue<Timestamp?>("completedAt", out var completedAt);

        return new TaskItem(
            Guid.Parse(doc.Id),
            doc.GetValue<string>("title"),
            notes,
            Enum.Parse<TaskState>(doc.GetValue<string>("status")),
            Enum.Parse<TaskPriority>(doc.GetValue<string>("priority")),
            dueDate is null ? null : DateOnly.ParseExact(dueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            tags ?? [],
            doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset(),
            completedAt?.ToDateTimeOffset());
    }
}
