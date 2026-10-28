namespace KnowledgeBase.Api.Tasks;

// Serialized in snake_case: "todo", "in_progress", "done".
public enum TaskState { Todo, InProgress, Done }

public enum TaskPriority { Low, Normal, High }

// Which list a task is on: the Personal or the Work side of the app. Serialized "personal", "work".
public enum TaskArea { Personal, Work }

// Named TaskItem to avoid clashing with System.Threading.Tasks.Task.
// DelegatedTo is the person you handed the task to, if anyone (one name, as you typed it).
// Category is one of the work categories from Settings; only work tasks have one, and a work task moved
// over from #work can have none yet.
public record TaskItem(
    Guid Id,
    string Title,
    string? Notes,
    TaskState Status,
    TaskPriority Priority,
    DateOnly? DueDate,
    IReadOnlyList<string> Tags,
    string? DelegatedTo,
    TaskArea Area,
    string? Category,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CompletedAt,
    IReadOnlyList<TaskPhoto> Photos);

// A photo attached to a task. The image itself is in the photo store (Cloud Storage), as a JPEG plus a
// small thumbnail; the task only lists it.
public record TaskPhoto(Guid Id, long Size, DateTimeOffset CreatedAt);

public interface ITaskStore
{
    Task<IReadOnlyList<TaskItem>> ListAsync();
    Task<TaskItem?> GetAsync(Guid id);
    Task AddAsync(TaskItem task);
    // Saves every field except Photos, which only change through the two methods below, so an edit
    // never undoes a photo added at the same moment.
    Task UpdateAsync(TaskItem task);
    // False when the task doesn't exist.
    Task<bool> AddPhotoAsync(Guid taskId, TaskPhoto photo);
    Task<bool> RemovePhotoAsync(Guid taskId, Guid photoId);
    Task<bool> DeleteAsync(Guid id);
}
