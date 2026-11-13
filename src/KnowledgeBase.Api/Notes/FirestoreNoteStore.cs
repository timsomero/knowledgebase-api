using System.Globalization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Notes;

// Stores notes in the "notes" collection; the document ID is the note's GUID.
public class FirestoreNoteStore(FirestoreDb db) : INoteStore
{
    private CollectionReference Notes => db.Collection("notes");

    public async Task<IReadOnlyList<Note>> ListAsync()
    {
        var snapshot = await Notes.OrderBy("createdAt").GetSnapshotAsync();
        return snapshot.Documents.Select(ToNote).ToList();
    }

    public async Task<Note?> GetAsync(Guid id)
    {
        var doc = await Notes.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToNote(doc) : null;
    }

    public Task AddAsync(Note note)
    {
        var fields = ToFields(note);
        fields["photos"] = note.Photos.Select(ToFields).ToList();
        return Notes.Document(note.Id.ToString()).CreateAsync(fields);
    }

    // Merging leaves the "photos" field as it is.
    public Task UpdateAsync(Note note) => Notes.Document(note.Id.ToString()).SetAsync(ToFields(note), SetOptions.MergeAll);

    public Task<bool> AddPhotoAsync(Guid noteId, NotePhoto photo) =>
        ChangePhotosAsync(noteId, photos => [.. photos, photo]);

    public Task<bool> RemovePhotoAsync(Guid noteId, Guid photoId) =>
        ChangePhotosAsync(noteId, photos => photos.Where(p => p.Id != photoId).ToList());

    // In a transaction, so two photos added at once both end up on the note.
    private Task<bool> ChangePhotosAsync(Guid noteId, Func<IReadOnlyList<NotePhoto>, IReadOnlyList<NotePhoto>> change) =>
        db.RunTransactionAsync(async transaction =>
        {
            var doc = Notes.Document(noteId.ToString());
            var snapshot = await transaction.GetSnapshotAsync(doc);
            if (!snapshot.Exists)
                return false;
            transaction.Update(doc, "photos", change(ToPhotos(snapshot)).Select(ToFields).ToList());
            return true;
        });

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Notes.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Dictionary<string, object?> ToFields(Note note) => new()
    {
        ["text"] = note.Text,
        ["html"] = note.Html,
        ["folder"] = note.Folder,
        ["pinned"] = note.Pinned,
        ["createdAt"] = Timestamp.FromDateTimeOffset(note.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(note.UpdatedAt),
    };

    private static Dictionary<string, object> ToFields(NotePhoto photo) => new()
    {
        ["id"] = photo.Id.ToString(),
        ["size"] = photo.Size,
        ["createdAt"] = Timestamp.FromDateTimeOffset(photo.CreatedAt),
    };

    private static List<NotePhoto> ToPhotos(DocumentSnapshot doc) =>
        doc.TryGetValue<List<Dictionary<string, object>>?>("photos", out var photos) && photos is not null
            ? photos.Select(p => new NotePhoto(
                Guid.Parse((string)p["id"]),
                Convert.ToInt64(p["size"], CultureInfo.InvariantCulture),
                ((Timestamp)p["createdAt"]).ToDateTimeOffset())).ToList()
            : [];

    // Notes saved before folders, pins, photos and rich text have only text and createdAt.
    private static Note ToNote(DocumentSnapshot doc)
    {
        doc.TryGetValue<string?>("html", out var html);
        doc.TryGetValue<string?>("folder", out var folder);
        doc.TryGetValue<bool?>("pinned", out var pinned);
        var createdAt = doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset();
        var updatedAt = doc.TryGetValue<Timestamp?>("updatedAt", out var updated) && updated is { } u ? u.ToDateTimeOffset() : createdAt;
        return new Note(Guid.Parse(doc.Id), doc.GetValue<string>("text"), html, folder, pinned ?? false, ToPhotos(doc), createdAt, updatedAt);
    }
}
