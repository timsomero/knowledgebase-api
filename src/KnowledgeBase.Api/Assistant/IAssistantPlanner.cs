namespace KnowledgeBase.Api.Assistant;

// Turns what you said into proposed changes, using the toolbox to look things up and to record each change
// (the toolbox holds the draft). Summary is one line for the preview's heading; Question (with Choices to
// tap) is set when it needs you to say which one you meant. Null means the assistant couldn't be reached
// or gave no usable answer.
public record PlannerResult(string Summary, string? Question, IReadOnlyList<string> Choices);

public interface IAssistantPlanner
{
    bool Enabled { get; }

    // History: the conversation so far (your earlier requests and its questions), oldest first. Message: what
    // you just said. The toolbox's draft is the current plan (empty for a new request).
    Task<PlannerResult?> PlanAsync(IReadOnlyList<AssistantTurn> history, string message, AssistantToolbox toolbox, CancellationToken cancellationToken);
}

// On Cloud Run without ANTHROPIC_API_KEY: the Ask button is hidden.
public class DisabledAssistantPlanner : IAssistantPlanner
{
    public bool Enabled => false;

    public Task<PlannerResult?> PlanAsync(IReadOnlyList<AssistantTurn> history, string message, AssistantToolbox toolbox, CancellationToken cancellationToken) =>
        Task.FromResult<PlannerResult?>(null);
}
