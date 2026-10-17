using System.Globalization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Workouts;

// Stores workouts in the "workouts" collection; the document ID is the workout's GUID.
// Kinds are stored as their names and the date as "yyyy-MM-dd" (Firestore has no date-only type).
public class FirestoreWorkoutStore(FirestoreDb db) : IWorkoutStore
{
    private CollectionReference Workouts => db.Collection("workouts");

    public async Task<IReadOnlyList<Workout>> ListAsync()
    {
        var snapshot = await Workouts.GetSnapshotAsync();
        return snapshot.Documents.Select(ToWorkout).ToList();
    }

    public async Task<Workout?> GetAsync(Guid id)
    {
        var doc = await Workouts.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToWorkout(doc) : null;
    }

    public Task AddAsync(Workout workout) => Workouts.Document(workout.Id.ToString()).CreateAsync(ToFields(workout));

    public Task UpdateAsync(Workout workout) => Workouts.Document(workout.Id.ToString()).SetAsync(ToFields(workout));

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Workouts.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Dictionary<string, object?> ToFields(Workout w) => new()
    {
        ["date"] = w.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ["categoryId"] = w.CategoryId,
        ["categoryName"] = w.CategoryName,
        ["kind"] = w.Kind.ToString(),
        ["activity"] = w.Activity,
        ["items"] = w.Items.ToList(),
        ["durationMinutes"] = w.DurationMinutes,
        ["distanceMiles"] = w.DistanceMiles,
        ["notes"] = w.Notes,
        ["createdAt"] = Timestamp.FromDateTimeOffset(w.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(w.UpdatedAt),
    };

    private static Workout ToWorkout(DocumentSnapshot doc)
    {
        doc.TryGetValue<string?>("activity", out var activity);
        doc.TryGetValue<List<string>?>("items", out var items);
        doc.TryGetValue<int?>("durationMinutes", out var duration);
        doc.TryGetValue<double?>("distanceMiles", out var distance);
        doc.TryGetValue<string?>("notes", out var notes);

        return new Workout(
            Guid.Parse(doc.Id),
            DateOnly.ParseExact(doc.GetValue<string>("date"), "yyyy-MM-dd", CultureInfo.InvariantCulture),
            doc.GetValue<string>("categoryId"),
            doc.GetValue<string>("categoryName"),
            Enum.Parse<WorkoutKind>(doc.GetValue<string>("kind")),
            activity,
            items ?? [],
            duration,
            distance,
            notes,
            doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
            doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset());
    }
}

// Keeps the whole Config page in one document, "workoutConfig/default".
public class FirestoreWorkoutConfigStore(FirestoreDb db) : IWorkoutConfigStore
{
    private DocumentReference Doc => db.Collection("workoutConfig").Document("default");

    public async Task<WorkoutConfig> GetAsync()
    {
        var doc = await Doc.GetSnapshotAsync();
        if (!doc.Exists)
            return WorkoutConfig.Default;

        var categories = doc.GetValue<List<Dictionary<string, object>>>("categories");
        return new WorkoutConfig(categories.Select(c => new WorkoutCategory(
            (string)c["id"],
            (string)c["name"],
            Enum.Parse<WorkoutKind>((string)c["kind"]),
            ((IEnumerable<object>)c["items"]).Cast<string>().ToList())).ToList());
    }

    public Task SaveAsync(WorkoutConfig config) => Doc.SetAsync(new Dictionary<string, object>
    {
        ["categories"] = config.Categories.Select(c => new Dictionary<string, object>
        {
            ["id"] = c.Id,
            ["name"] = c.Name,
            ["kind"] = c.Kind.ToString(),
            ["items"] = c.Items.ToList(),
        }).ToList(),
    });
}
