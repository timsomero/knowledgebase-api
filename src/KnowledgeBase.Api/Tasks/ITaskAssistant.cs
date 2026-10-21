namespace KnowledgeBase.Api.Tasks;

// What the assistant reads out of a quickly typed (or dictated) task. Null or empty means
// "not mentioned"; Tags only ever holds tags from the list it was given.
public record TaskSuggestion(
    string Title,
    string? Notes,
    DateOnly? DueDate,
    TaskPriority? Priority,
    IReadOnlyList<string> Tags);

public interface ITaskAssistant
{
    // False when no assistant is configured; the web app then skips the tidy-up step.
    bool Enabled { get; }

    // Null when the assistant can't be reached or gives no usable answer.
    Task<TaskSuggestion?> SuggestAsync(string text, DateOnly today, IReadOnlyList<string> knownTags, CancellationToken cancellationToken);
}

// Used on Cloud Run until ANTHROPIC_API_KEY is set: tasks are saved exactly as typed.
public class DisabledTaskAssistant : ITaskAssistant
{
    public bool Enabled => false;

    public Task<TaskSuggestion?> SuggestAsync(string text, DateOnly today, IReadOnlyList<string> knownTags, CancellationToken cancellationToken) =>
        Task.FromResult<TaskSuggestion?>(null);
}
