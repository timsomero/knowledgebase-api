using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Ideas;

// Stores ideas in the "ideas" collection; the document ID is the idea's GUID.
public class FirestoreIdeaStore(FirestoreDb db) : IIdeaStore
{
    private CollectionReference Ideas => db.Collection("ideas");

    public async Task<IReadOnlyList<Idea>> ListAsync()
    {
        var snapshot = await Ideas.OrderByDescending("updatedAt").GetSnapshotAsync();
        return snapshot.Documents.Select(ToIdea).ToList();
    }

    public async Task<Idea?> GetAsync(Guid id)
    {
        var doc = await Ideas.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? ToIdea(doc) : null;
    }

    public Task AddAsync(Idea idea) => Ideas.Document(idea.Id.ToString()).CreateAsync(ToFields(idea));

    public Task UpdateAsync(Idea idea) => Ideas.Document(idea.Id.ToString()).SetAsync(ToFields(idea), SetOptions.MergeAll);

    public async Task<bool> DeleteAsync(Guid id)
    {
        var doc = Ideas.Document(id.ToString());
        if (!(await doc.GetSnapshotAsync()).Exists)
            return false;

        await doc.DeleteAsync();
        return true;
    }

    private static Dictionary<string, object> ToFields(Idea idea) => new()
    {
        ["title"] = idea.Title,
        ["text"] = idea.Text,
        ["createdAt"] = Timestamp.FromDateTimeOffset(idea.CreatedAt),
        ["updatedAt"] = Timestamp.FromDateTimeOffset(idea.UpdatedAt),
    };

    private static Idea ToIdea(DocumentSnapshot doc) => new(
        Guid.Parse(doc.Id),
        doc.GetValue<string>("title"),
        doc.GetValue<string>("text"),
        doc.GetValue<Timestamp>("createdAt").ToDateTimeOffset(),
        doc.GetValue<Timestamp>("updatedAt").ToDateTimeOffset());
}
