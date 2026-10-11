using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Notes;

// Used for local development; data is lost when the process stops.
public class InMemoryNoteStore : INoteStore
{
    private readonly ConcurrentDictionary<Guid, Note> _notes = new();

    public Task<IReadOnlyList<Note>> ListAsync() =>
        Task.FromResult<IReadOnlyList<Note>>(_notes.Values.OrderBy(n => n.CreatedAt).ToList());

    public Task<Note?> GetAsync(Guid id) =>
        Task.FromResult(_notes.TryGetValue(id, out var note) ? note : null);

    public Task AddAsync(Note note)
    {
        _notes[note.Id] = note;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_notes.TryRemove(id, out _));
}
