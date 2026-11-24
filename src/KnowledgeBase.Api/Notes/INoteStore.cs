namespace KnowledgeBase.Api.Notes;

// A note, like Apple Notes: free text whose first line reads as its title (Text, the plain version used for
// the list, search and title) with its formatting in Html (bold, headings, lists, checklists; null for notes
// written before rich text, which show Text as it is), an optional folder (null means
// Unfiled, to sort later), pinned to the top or not, and photos. Notes saved before folders, pins and
// photos existed have none, and their UpdatedAt is their CreatedAt. Log is set when the note is a running log
// (say, home maintenance, its entries a list in the text): the latest entry's date and next due date. Null for a plain note.
public record Note(
    Guid Id,
    string Text,
    string? Html,
    string? Folder,
    bool Pinned,
    IReadOnlyList<NotePhoto> Photos,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    NoteLog? Log = null);

// Dates are calendar days ("2026-11-24" in JSON), as picked on the phone, with no time or time zone.
public record NoteLog(DateOnly Date, DateOnly? NextDue);

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
