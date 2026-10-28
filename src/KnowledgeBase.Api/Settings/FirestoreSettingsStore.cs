using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Settings;

// Keeps the Settings screen in one document, "settings/default".
public class FirestoreSettingsStore(FirestoreDb db) : ISettingsStore
{
    private DocumentReference Doc => db.Collection("settings").Document("default");

    public async Task<AppSettings> GetAsync()
    {
        var doc = await Doc.GetSnapshotAsync();
        return doc.Exists && doc.TryGetValue<List<string>>("workCategories", out var categories)
            ? new AppSettings(categories)
            : AppSettings.Default;
    }

    public Task SaveAsync(AppSettings settings) => Doc.SetAsync(new Dictionary<string, object>
    {
        ["workCategories"] = settings.WorkCategories.ToList(),
    });
}
