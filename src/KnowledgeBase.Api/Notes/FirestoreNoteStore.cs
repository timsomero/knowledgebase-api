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

    public Task AddAsync(Note note) =>
        Notes.Document(note.Id.ToString()).CreateAsync(new Dictionary<string, object>
        {
            ["text"] = note.Text,
            ["createdAt"] = Timestamp.FromDateTimeOffset(note.CreatedAt),
        });

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Notes.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Note ToNote(DocumentSnapshot doc) => new(
        Guid.Parse(doc.Id),
        doc.GetValue<string>("text"),
        doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset());
}
