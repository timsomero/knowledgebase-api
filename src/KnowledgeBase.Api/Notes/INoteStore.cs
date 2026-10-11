namespace KnowledgeBase.Api.Notes;

public record Note(Guid Id, string Text, DateTimeOffset CreatedAt);

public interface INoteStore
{
    Task<IReadOnlyList<Note>> ListAsync();
    Task<Note?> GetAsync(Guid id);
    Task AddAsync(Note note);
    Task<bool> DeleteAsync(Guid id);
}
