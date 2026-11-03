using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Ideas;

// An idea you caught, kept exactly as typed or dictated. CreatedAt is when it was first caught; UpdatedAt
// moves each time you add to it.
public record Idea(Guid Id, string Title, string Text, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public interface IIdeaStore
{
    // Most recently changed first.
    Task<IReadOnlyList<Idea>> ListAsync();
    Task<Idea?> GetAsync(Guid id);
    Task AddAsync(Idea idea);
    Task UpdateAsync(Idea idea);
    // False when the idea doesn't exist.
    Task<bool> DeleteAsync(Guid id);
}

// Used for local development; data is lost when the process stops.
public class InMemoryIdeaStore : IIdeaStore
{
    private readonly ConcurrentDictionary<Guid, Idea> _ideas = new();

    public Task<IReadOnlyList<Idea>> ListAsync() =>
        Task.FromResult<IReadOnlyList<Idea>>(_ideas.Values.OrderByDescending(i => i.UpdatedAt).ToList());

    public Task<Idea?> GetAsync(Guid id) =>
        Task.FromResult(_ideas.TryGetValue(id, out var idea) ? idea : null);

    public Task AddAsync(Idea idea)
    {
        _ideas[idea.Id] = idea;
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Idea idea)
    {
        _ideas[idea.Id] = idea;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_ideas.TryRemove(id, out _));
}
