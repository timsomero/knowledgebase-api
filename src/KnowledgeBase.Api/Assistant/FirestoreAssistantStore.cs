using System.Text.Json;
using System.Text.Json.Serialization;
using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Assistant;

// Plans live in "assistantPlans" and submitted batches in "assistantBatches"; the document ID is the GUID.
// Each document keeps the whole record as JSON in "json" (they are only ever read back whole by this app),
// plus "at" to list batches newest first.
public class FirestoreAssistantStore(FirestoreDb db) : IAssistantStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    private CollectionReference Plans => db.Collection("assistantPlans");
    private CollectionReference Batches => db.Collection("assistantBatches");

    public async Task<AssistantPlan?> GetPlanAsync(Guid id)
    {
        var doc = await Plans.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? JsonSerializer.Deserialize<AssistantPlan>(doc.GetValue<string>("json"), Json) : null;
    }

    public Task SavePlanAsync(AssistantPlan plan) => Plans.Document(plan.Id.ToString()).SetAsync(new Dictionary<string, object>
    {
        ["at"] = Timestamp.FromDateTimeOffset(plan.UpdatedAt),
        ["json"] = JsonSerializer.Serialize(plan, Json),
    });

    public async Task<IReadOnlyList<AssistantBatch>> ListBatchesAsync(int limit)
    {
        var snapshot = await Batches.OrderByDescending("at").Limit(limit).GetSnapshotAsync();
        return snapshot.Documents.Select(d => JsonSerializer.Deserialize<AssistantBatch>(d.GetValue<string>("json"), Json)!).ToList();
    }

    public async Task<AssistantBatch?> GetBatchAsync(Guid id)
    {
        var doc = await Batches.Document(id.ToString()).GetSnapshotAsync();
        return doc.Exists ? JsonSerializer.Deserialize<AssistantBatch>(doc.GetValue<string>("json"), Json) : null;
    }

    public Task SaveBatchAsync(AssistantBatch batch) => Batches.Document(batch.Id.ToString()).SetAsync(new Dictionary<string, object>
    {
        ["at"] = Timestamp.FromDateTimeOffset(batch.At),
        ["json"] = JsonSerializer.Serialize(batch, Json),
    });

    public async Task<int> PurgeAsync(DateTimeOffset? before)
    {
        var count = 0;
        foreach (var collection in new[] { Plans, Batches })
        {
            Query query = before is { } cutoff ? collection.WhereLessThan("at", Timestamp.FromDateTimeOffset(cutoff)) : collection;
            var snapshot = await query.GetSnapshotAsync();
            // A write batch holds at most 500 writes.
            foreach (var chunk in snapshot.Documents.Chunk(500))
            {
                var batch = db.StartBatch();
                foreach (var doc in chunk)
                    batch.Delete(doc.Reference);
                await batch.CommitAsync();
                count += chunk.Length;
            }
        }
        return count;
    }
}
