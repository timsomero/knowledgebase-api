using Google.Cloud.Firestore;

namespace KnowledgeBase.Api.Settings;

// Keeps the Settings screen in one document, "settings/default".
public class FirestoreSettingsStore(FirestoreDb db) : ISettingsStore
{
    private DocumentReference Doc => db.Collection("settings").Document("default");

    public async Task<AppSettings> GetAsync()
    {
        var doc = await Doc.GetSnapshotAsync();
        if (!doc.Exists)
            return AppSettings.Default;
        doc.TryGetValue<List<string>?>("team", out var team);
        return doc.TryGetValue<List<string>>("workCategories", out var categories)
            ? new AppSettings(categories, team)
            : AppSettings.Default with { Team = team };
    }

    public Task SaveAsync(AppSettings settings) => Doc.SetAsync(new Dictionary<string, object?>
    {
        ["workCategories"] = settings.WorkCategories.ToList(),
        ["team"] = settings.Team?.ToList(),
    });
}
