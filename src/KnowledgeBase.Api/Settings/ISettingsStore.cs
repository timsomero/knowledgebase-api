namespace KnowledgeBase.Api.Settings;

// The Settings screen. WorkCategories are offered (and one is required) when adding a task in Work mode.
public record AppSettings(IReadOnlyList<string> WorkCategories)
{
    public static AppSettings Default { get; } = new(
    [
        "Menu Maintenance and Delivery",
        "CV Cloud",
        "Administrative",
        "Personnel and HR",
        "Resiliency",
    ]);
}

public interface ISettingsStore
{
    // Returns AppSettings.Default until settings have been saved.
    Task<AppSettings> GetAsync();
    Task SaveAsync(AppSettings settings);
}

public class InMemorySettingsStore : ISettingsStore
{
    private AppSettings _settings = AppSettings.Default;

    public Task<AppSettings> GetAsync() => Task.FromResult(_settings);

    public Task SaveAsync(AppSettings settings)
    {
        _settings = settings;
        return Task.CompletedTask;
    }
}
