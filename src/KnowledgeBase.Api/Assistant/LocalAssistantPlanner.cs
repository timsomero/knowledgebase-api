using System.Text.RegularExpressions;
using KnowledgeBase.Api.Tasks;
using KnowledgeBase.Api.Workouts;

namespace KnowledgeBase.Api.Assistant;

// Stand-in for local runs with in-memory storage, so the assistant screens can be tried without an API key.
// It understands only a few shapes of request, through the same toolbox Claude uses:
//  - "move/push (personal|work) tasks due today to <weekday|tomorrow>"
//  - "<minutes> minutes <cardio activity> [<miles> miles]" and muscle group names from the checklist category
//  - "<project name>: <activity>" (or "on <project name>, <activity>"); two matching projects ask which one
//  - "leave <words> alone" while refining drops the task update whose title has those words
// Text containing "[offline]" behaves as if the assistant were unreachable.
public partial class LocalAssistantPlanner : IAssistantPlanner
{
    public bool Enabled => true;

    public async Task<PlannerResult?> PlanAsync(IReadOnlyList<AssistantTurn> history, string message, AssistantToolbox toolbox, CancellationToken cancellationToken)
    {
        await Task.Delay(900, cancellationToken); // feel like a real call
        if (message.Contains("[offline]", StringComparison.OrdinalIgnoreCase))
            return null;
        var text = message.ToLowerInvariant();

        if (LeaveAlone().Match(text) is { Success: true } leave)
        {
            foreach (var change in toolbox.Changes.Where(c => c.Title.Contains(leave.Groups[1].Value.Trim(), StringComparison.OrdinalIgnoreCase)).ToList())
                toolbox.RemoveChange(new(change.Id));
            return new PlannerResult(Summary(toolbox), null, []);
        }

        // An answer to "which project?" continues the request it was asked about.
        if (history.Count >= 2 && history[^1].Role == "assistant")
            return PlanProject(history[^2].Text, message, toolbox) ?? new PlannerResult(Summary(toolbox), null, []);

        if (text.Contains("due today") && Target(text, toolbox.Today) is { } target)
        {
            var area = text.Contains("work") ? "work" : text.Contains("personal") ? "personal" : null;
            var today = AssistantToolbox.Day(toolbox.Today);
            foreach (var task in toolbox.Tasks.Where(t => t.Status != TaskState.Done && t.DueDate == toolbox.Today
                         && (area is null || t.Area.ToString().Equals(area, StringComparison.OrdinalIgnoreCase))))
                toolbox.ProposeTaskUpdate(new(task.Id.ToString(), null, null, AssistantToolbox.Day(target), null, null, null));
            return new PlannerResult(toolbox.Changes.Count == 0 ? $"No {area ?? "open"} tasks are due today ({today})." : Summary(toolbox), null, []);
        }

        var workouts = PlanWorkouts(text, toolbox);
        var project = PlanProject(message, null, toolbox);
        if (project?.Question is not null)
            return project;
        if (workouts || project is not null)
            return new PlannerResult(Summary(toolbox), null, []);

        return new PlannerResult("The stand-in assistant didn't understand that. Try \"push personal tasks due today to Monday\".", null, []);
    }

    private static bool PlanWorkouts(string text, AssistantToolbox toolbox)
    {
        var any = false;
        var minutes = Minutes().Match(text) is { Success: true } m ? int.Parse(m.Groups[1].Value) : (int?)null;
        var miles = Miles().Match(text) is { Success: true } mi ? double.Parse(mi.Groups[1].Value) : (double?)null;
        foreach (var category in toolbox.WorkoutConfig.Categories)
        {
            if (category.Kind == WorkoutKind.Activity && minutes is not null
                && category.Items.FirstOrDefault(i => text.Contains(i.ToLowerInvariant()) || (i == "Cycling" && text.Contains("bike"))) is { } activity)
            {
                toolbox.ProposeWorkout(new(null, category.Id, activity, null, minutes, miles, null));
                any = true;
            }
            else if (category.Kind == WorkoutKind.Checklist)
            {
                var items = category.Items.Where(i => text.Contains(i.ToLowerInvariant())).ToList();
                if (items.Count > 0)
                {
                    toolbox.ProposeWorkout(new(null, category.Id, null, items, null, null, null));
                    any = true;
                }
            }
        }
        return any;
    }

    // "<name>: <activity>" or "on <name>, <activity>". Answer is the user's reply to "which project?".
    private static PlannerResult? PlanProject(string request, string? answer, AssistantToolbox toolbox)
    {
        var match = ProjectLine().Match(request);
        if (!match.Success)
            return null;
        var name = match.Groups[1].Value.Trim();
        var activity = match.Groups[2].Value.Trim();
        var candidates = toolbox.Projects
            .Where(p => p.Name.Contains(answer?.Trim() ?? name, StringComparison.OrdinalIgnoreCase)
                        || (answer is null && name.Split(' ').Any(w => w.Length > 3 && p.Name.Contains(w, StringComparison.OrdinalIgnoreCase))))
            .ToList();
        if (candidates.Count == 0)
            return null;
        if (candidates.Count > 1)
            return new PlannerResult("", $"Which project do you mean? {candidates.Count} match \"{name}\".", candidates.Select(p => p.Name).Take(4).ToList());
        toolbox.ProposeProjectUpdate(new(candidates[0].Id.ToString(), char.ToUpperInvariant(activity[0]) + activity[1..], null));
        return new PlannerResult(Summary(toolbox), null, []);
    }

    private static DateOnly? Target(string text, DateOnly today)
    {
        if (text.Contains("tomorrow"))
            return today.AddDays(1);
        foreach (var day in Enum.GetValues<DayOfWeek>())
        {
            if (!text.Contains(day.ToString().ToLowerInvariant()))
                continue;
            var ahead = ((int)day - (int)today.DayOfWeek + 7) % 7;
            return today.AddDays(ahead == 0 ? 7 : ahead);
        }
        return null;
    }

    private static string Summary(AssistantToolbox toolbox) => toolbox.Changes.Count switch
    {
        0 => "Nothing to change.",
        1 => "1 change",
        var n => $"{n} changes",
    };

    [GeneratedRegex(@"leave (?:the )?(.+?)(?: one| task)? alone")]
    private static partial Regex LeaveAlone();

    [GeneratedRegex(@"(\d+)\s*(?:min|minutes)")]
    private static partial Regex Minutes();

    [GeneratedRegex(@"(\d+(?:\.\d+)?)\s*(?:mi|miles)\b")]
    private static partial Regex Miles();

    [GeneratedRegex(@"^(?:on |for )?(?:the )?([^:,]{3,60}?)(?: project)?[:,]\s*(.+)$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex ProjectLine();
}
