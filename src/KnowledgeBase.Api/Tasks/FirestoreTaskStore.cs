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

    public Task AddAsync(TaskItem task)
    {
        var fields = ToFields(task);
        fields["photos"] = task.Photos.Select(ToFields).ToList();
        return Tasks.Document(task.Id.ToString()).CreateAsync(fields);
    }

    // Merging leaves the "photos" field as it is.
    public Task UpdateAsync(TaskItem task) => Tasks.Document(task.Id.ToString()).SetAsync(ToFields(task), SetOptions.MergeAll);

    public Task<bool> AddPhotoAsync(Guid taskId, TaskPhoto photo) =>
        ChangePhotosAsync(taskId, photos => [.. photos, photo]);

    public Task<bool> RemovePhotoAsync(Guid taskId, Guid photoId) =>
        ChangePhotosAsync(taskId, photos => photos.Where(p => p.Id != photoId).ToList());

    // In a transaction, so two photos added at once both end up on the task.
    private Task<bool> ChangePhotosAsync(Guid taskId, Func<IReadOnlyList<TaskPhoto>, IReadOnlyList<TaskPhoto>> change) =>
        db.RunTransactionAsync(async transaction =>
        {
            var doc = Tasks.Document(taskId.ToString());
            var snapshot = await transaction.GetSnapshotAsync(doc);
            if (!snapshot.Exists)
                return false;
            var photos = change(ToPhotos(snapshot));
            transaction.Update(doc, "photos", photos.Select(ToFields).ToList());
            return true;
        });

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
        ["delegatedTo"] = task.DelegatedTo,
        ["area"] = task.Area.ToString(),
        ["category"] = task.Category,
        ["createdAt"] = Timestamp.FromDateTimeOffset(task.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(task.UpdatedAt),
        ["completedAt"] = task.CompletedAt is { } c ? Timestamp.FromDateTimeOffset(c) : null,
    };

    private static Dictionary<string, object> ToFields(TaskPhoto photo) => new()
    {
        ["id"] = photo.Id.ToString(),
        ["size"] = photo.Size,
        ["createdAt"] = Timestamp.FromDateTimeOffset(photo.CreatedAt),
    };

    private static List<TaskPhoto> ToPhotos(DocumentSnapshot doc) =>
        doc.TryGetValue<List<Dictionary<string, object>>?>("photos", out var photos) && photos is not null
            ? photos.Select(p => new TaskPhoto(
                Guid.Parse((string)p["id"]),
                Convert.ToInt64(p["size"], CultureInfo.InvariantCulture),
                ((Timestamp)p["createdAt"]).ToDateTimeOffset())).ToList()
            : [];

    // Tasks saved before Work mode existed: the ones tagged #work belong on the Work side.
    private static TaskArea DefaultArea(List<string>? tags) =>
        tags?.Contains("work", StringComparer.OrdinalIgnoreCase) == true ? TaskArea.Work : TaskArea.Personal;

    private static TaskItem ToTask(DocumentSnapshot doc)
    {
        doc.TryGetValue<string?>("notes", out var notes);
        doc.TryGetValue<string?>("dueDate", out var dueDate);
        doc.TryGetValue<List<string>?>("tags", out var tags);
        doc.TryGetValue<string?>("delegatedTo", out var delegatedTo);
        doc.TryGetValue<string?>("area", out var area);
        doc.TryGetValue<string?>("category", out var category);
        doc.TryGetValue<Timestamp?>("completedAt", out var completedAt);

        return new TaskItem(
            Guid.Parse(doc.Id),
            doc.GetValue<string>("title"),
            notes,
            Enum.Parse<TaskState>(doc.GetValue<string>("status")),
            Enum.Parse<TaskPriority>(doc.GetValue<string>("priority")),
            dueDate is null ? null : DateOnly.ParseExact(dueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            tags ?? [],
            delegatedTo,
            area is null ? DefaultArea(tags) : Enum.Parse<TaskArea>(area),
            category,
            doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset(),
            completedAt?.ToDateTimeOffset(),
            ToPhotos(doc));
    }
}
