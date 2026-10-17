namespace KnowledgeBase.Api.Tasks;

// Serialized in snake_case: "todo", "in_progress", "done".
public enum TaskState { Todo, InProgress, Done }

public enum TaskPriority { Low, Normal, High }

// Named TaskItem to avoid clashing with System.Threading.Tasks.Task.
public record TaskItem(
    Guid Id,
    string Title,
    string? Notes,
    TaskState Status,
    TaskPriority Priority,
    DateOnly? DueDate,
    IReadOnlyList<string> Tags,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CompletedAt);

public interface ITaskStore
{
    Task<IReadOnlyList<TaskItem>> ListAsync();
    Task<TaskItem?> GetAsync(Guid id);
    Task AddAsync(TaskItem task);
    Task UpdateAsync(TaskItem task);
    Task<bool> DeleteAsync(Guid id);
}
