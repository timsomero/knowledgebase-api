namespace KnowledgeBase.Api.Notes;

// A note, like Apple Notes: an optional Title (null means the first line of the text reads as its title, as
// for notes saved before titles existed), free text (Text, the plain version used for the list and search) with its formatting in Html (bold, headings, lists, checklists; null for notes
// written before rich text, which show Text as it is), an optional folder (null means
// Unfiled, to sort later), pinned to the top or not, and photos. Notes saved before folders, pins and
// photos existed have none, and their UpdatedAt is their CreatedAt.
public record Note(
    Guid Id,
    string? Title,
    string Text,
    string? Html,
    string? Folder,
    bool Pinned,
    IReadOnlyList<NotePhoto> Photos,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record NotePhoto(Guid Id, long Size, DateTimeOffset CreatedAt);

public interface INoteStore
{
    Task<IReadOnlyList<Note>> ListAsync();
    Task<Note?> GetAsync(Guid id);
    Task AddAsync(Note note);

    // Saves every field except Photos, which only change through the methods below, so saving the text
    // while a photo uploads loses neither.
    Task UpdateAsync(Note note);

    // False when there is no such note.
    Task<bool> AddPhotoAsync(Guid noteId, NotePhoto photo);
    Task<bool> RemovePhotoAsync(Guid noteId, Guid photoId);

    Task<bool> DeleteAsync(Guid id);
}
