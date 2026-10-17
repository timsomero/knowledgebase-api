namespace KnowledgeBase.Api.Workouts;

// How a category is logged. Serialized in snake_case: "activity", "checklist".
//  - Activity: pick one activity from the category's list, plus a duration (e.g. Cardio).
//  - Checklist: tick any number of the category's items, no duration (e.g. Weight Training).
public enum WorkoutKind { Activity, Checklist }

// A category on the Config page; Items are its activities or muscle groups.
public record WorkoutCategory(string Id, string Name, WorkoutKind Kind, IReadOnlyList<string> Items);

public record WorkoutConfig(IReadOnlyList<WorkoutCategory> Categories)
{
    public static WorkoutConfig Default { get; } = new(
    [
        new("cardio", "Cardio", WorkoutKind.Activity, ["Cycling", "Running", "Rowing", "Walking"]),
        new("weights", "Weight Training", WorkoutKind.Checklist, ["Chest", "Triceps", "Quads", "Calves", "Back", "Biceps"]),
        new("flexibility", "Flexibility", WorkoutKind.Activity, ["Stretching", "Yoga"]),
        new("sports", "Sports", WorkoutKind.Activity, []),
        new("other", "Other", WorkoutKind.Activity, []),
    ]);
}

// A logged workout. The category's name and kind are copied in, so renaming or removing a
// category or item on the Config page never changes workouts already logged.
public record Workout(
    Guid Id,
    DateOnly Date,
    string CategoryId,
    string CategoryName,
    WorkoutKind Kind,
    string? Activity,
    IReadOnlyList<string> Items,
    int? DurationMinutes,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public interface IWorkoutStore
{
    Task<IReadOnlyList<Workout>> ListAsync();
    Task<Workout?> GetAsync(Guid id);
    Task AddAsync(Workout workout);
    Task UpdateAsync(Workout workout);
    Task<bool> DeleteAsync(Guid id);
}

public interface IWorkoutConfigStore
{
    // Returns WorkoutConfig.Default until a config has been saved.
    Task<WorkoutConfig> GetAsync();
    Task SaveAsync(WorkoutConfig config);
}
