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

    public Task UpdateAsync(Note note)
    {
        _notes.AddOrUpdate(note.Id, note, (_, old) => note with { Photos = old.Photos });
        return Task.CompletedTask;
    }

    public Task<bool> AddPhotoAsync(Guid noteId, NotePhoto photo) =>
        Task.FromResult(Change(noteId, n => n with { Photos = [.. n.Photos, photo] }));

    public Task<bool> RemovePhotoAsync(Guid noteId, Guid photoId) =>
        Task.FromResult(Change(noteId, n => n with { Photos = n.Photos.Where(p => p.Id != photoId).ToList() }));

    private bool Change(Guid id, Func<Note, Note> change)
    {
        while (_notes.TryGetValue(id, out var note))
            if (_notes.TryUpdate(id, change(note), note))
                return true;
        return false;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_notes.TryRemove(id, out _));
}
