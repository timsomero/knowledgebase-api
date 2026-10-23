using System.Text.RegularExpressions;

namespace KnowledgeBase.Api.Tasks;

// Stand-in for local runs with in-memory storage, so the tidy-up can be tried without an API key.
// It only knows a few words: "today", "tomorrow", a weekday, "urgent"/"asap", "no rush", and
// existing tag and people names. Text containing "[offline]" behaves as if the assistant were unreachable.
public partial class LocalTaskAssistant : ITaskAssistant
{
    public bool Enabled => true;

    public async Task<TaskSuggestion?> SuggestAsync(string text, DateOnly today, IReadOnlyList<string> knownTags, IReadOnlyList<string> knownPeople, CancellationToken cancellationToken)
    {
        await Task.Delay(800, cancellationToken); // feel like a real call
        if (text.Contains("[offline]", StringComparison.OrdinalIgnoreCase))
            return null;

        var lower = text.ToLowerInvariant();
        DateOnly? due = null;
        if (lower.Contains("today")) due = today;
        else if (lower.Contains("tomorrow")) due = today.AddDays(1);
        else
        {
            foreach (var day in Enum.GetValues<DayOfWeek>())
            {
                if (!lower.Contains(day.ToString().ToLowerInvariant()))
                    continue;
                var ahead = ((int)day - (int)today.DayOfWeek + 7) % 7;
                due = today.AddDays(ahead == 0 ? 7 : ahead);
                break;
            }
        }

        TaskPriority? priority = lower.Contains("urgent") || lower.Contains("asap") ? TaskPriority.High
            : lower.Contains("no rush") ? TaskPriority.Low
            : null;

        var tags = knownTags.Where(t => Regex.IsMatch(lower, $@"\b{Regex.Escape(t.ToLowerInvariant())}\b")).ToList();

        var person = knownPeople.FirstOrDefault(p => Regex.IsMatch(lower, $@"\b{Regex.Escape(p.ToLowerInvariant())}\b"));

        var title = Filler().Replace(text.Trim(), "").Trim();
        title = title.Length == 0 ? text.Trim() : char.ToUpperInvariant(title[0]) + title[1..];
        return new TaskSuggestion(title, null, due, priority, tags, person);
    }

    [GeneratedRegex(@"^(remind me to|i need to|need to|don't forget to)\s+", RegexOptions.IgnoreCase)]
    private static partial Regex Filler();
}
