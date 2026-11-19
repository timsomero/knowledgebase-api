using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using KnowledgeBase.Api.Projects;
using KnowledgeBase.Api.Settings;
using KnowledgeBase.Api.Tasks;
using KnowledgeBase.Api.Workouts;

namespace KnowledgeBase.Api.Assistant;

// What the assistant can do while it plans: look things up (tasks, projects, workouts, as they are now) and
// propose changes, which are checked here and collected into the draft. It never writes anything; that only
// happens when you submit the plan (AssistantEndpoints.ApplyAsync). Every answer is short JSON or a sentence
// the model can act on, including why a proposal was refused, so it can correct itself.
public class AssistantToolbox
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private const int MaxResults = 60;
    private const int MaxTitleLength = 200;
    private const int MaxTextLength = 2000;

    private readonly List<AssistantChange> _changes;
    private int _nextId;

    public DateOnly Today { get; }
    public IReadOnlyList<TaskItem> Tasks { get; }
    // The projects on the board; archived ones are kept apart, so names only match them when asked for.
    public IReadOnlyList<Project> Projects { get; }
    public IReadOnlyList<Project> ArchivedProjects { get; }
    public IReadOnlyList<Workout> Workouts { get; }
    public WorkoutConfig WorkoutConfig { get; }
    public AppSettings Settings { get; }
    public IReadOnlyList<AssistantChange> Changes => _changes;

    public AssistantToolbox(DateOnly today, IReadOnlyList<TaskItem> tasks, IReadOnlyList<Project> projects,
        IReadOnlyList<Workout> workouts, WorkoutConfig workoutConfig, AppSettings settings, IReadOnlyList<AssistantChange> draft)
    {
        Today = today;
        Tasks = tasks;
        Projects = projects.Where(p => p.ArchivedAt is null).ToList();
        ArchivedProjects = projects.Where(p => p.ArchivedAt is not null).ToList();
        Workouts = workouts;
        WorkoutConfig = workoutConfig;
        Settings = settings;
        _changes = [.. draft];
        _nextId = draft.Select(c => int.TryParse(c.Id.TrimStart('c'), out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
    }

    public static async Task<AssistantToolbox> LoadAsync(DateOnly today, IReadOnlyList<AssistantChange> draft,
        ITaskStore tasks, IProjectStore projects, IWorkoutStore workouts, IWorkoutConfigStore workoutConfig, ISettingsStore settings) =>
        new(today, await tasks.ListAsync(), await projects.ListAsync(),
            (await workouts.ListAsync()).Where(w => w.Date >= today.AddDays(-60)).ToList(),
            await workoutConfig.GetAsync(), await settings.GetAsync(), draft);

    // ---------- looking things up ----------

    public record FindTasksInput(string? Text, string? Area, string? Status, string? DueFrom, string? DueTo, bool? NoDueDate);

    public string FindTasks(FindTasksInput input)
    {
        var from = ParseDay(input.DueFrom);
        var to = ParseDay(input.DueTo);
        var words = Words(input.Text);
        var found = Tasks
            .Where(t => input.Status switch
            {
                "done" => t.Status == TaskState.Done,
                "any" => true,
                _ => t.Status != TaskState.Done,
            })
            .Where(t => input.Area is not ("personal" or "work") || t.Area.ToString().Equals(input.Area, StringComparison.OrdinalIgnoreCase))
            .Where(t => from is null || t.DueDate >= from)
            .Where(t => to is null || t.DueDate <= to)
            .Where(t => input.NoDueDate != true || t.DueDate is null)
            .Where(t => words.Count == 0 || words.All(w => Contains($"{t.Title} {t.Notes} {t.DelegatedTo} {t.Category} {string.Join(' ', t.Tags)}", w)))
            .OrderBy(t => t.DueDate ?? DateOnly.MaxValue)
            .ToList();

        return JsonSerializer.Serialize(new
        {
            count = found.Count,
            tasks = found.Take(MaxResults).Select(t => new
            {
                id = t.Id,
                t.Title,
                t.Area,
                t.Category,
                t.Status,
                t.Priority,
                dueDate = t.DueDate is { } d ? Day(d) : null,
                t.DelegatedTo,
                tags = t.Tags.Count > 0 ? t.Tags : null,
                notes = Short(t.Notes, 200),
            }),
            more = found.Count > MaxResults ? $"Only the first {MaxResults} are listed; narrow the search." : null,
        }, Json);
    }

    // Archived: search the archived projects instead of the board.
    public record FindProjectsInput(string? Text, bool? Archived = null);

    public string FindProjects(FindProjectsInput input)
    {
        var words = Words(input.Text);
        var found = (input.Archived == true ? ArchivedProjects : Projects)
            .Where(p => words.Count == 0 || words.Any(w => Contains($"{p.Name} {p.Category}", w)))
            .OrderByDescending(p => words.Count(w => Contains(p.Name, w)))
            .ToList();
        return JsonSerializer.Serialize(new
        {
            count = found.Count,
            projects = found.Take(MaxResults).Select(p => new
            {
                id = p.Id,
                p.Name,
                p.Category,
                p.Health,
                targetDate = p.TargetDate is { } d ? Day(d) : null,
                archived = p.ArchivedAt is { } a ? Day(DateOnly.FromDateTime(a.UtcDateTime)) : null,
                goal = Short(p.Goal, 200),
                recentActivity = p.Log.Where(e => !e.Auto).TakeLast(3).Select(e => $"{Day(DateOnly.FromDateTime(e.At.UtcDateTime))}: {Short(e.Text, 200)}"),
            }),
        }, Json);
    }

    public record FindWorkoutsInput(string? From, string? To);

    public string FindWorkouts(FindWorkoutsInput input)
    {
        var from = ParseDay(input.From) ?? Today.AddDays(-14);
        var to = ParseDay(input.To) ?? Today;
        return JsonSerializer.Serialize(Workouts
            .Where(w => w.Date >= from && w.Date <= to)
            .OrderByDescending(w => w.Date)
            .Take(MaxResults)
            .Select(w => new
            {
                date = Day(w.Date),
                category = w.CategoryName,
                w.Activity,
                items = w.Items.Count > 0 ? w.Items : null,
                w.DurationMinutes,
                w.DistanceMiles,
                w.Notes,
            }), Json);
    }

    // ---------- proposing changes ----------

    public record ProposeTaskUpdateInput(string? TaskId, string? Title, string? Notes, string? DueDate, bool? ClearDueDate, string? Status, string? Priority);

    public string ProposeTaskUpdate(ProposeTaskUpdateInput input)
    {
        if (FindTask(input.TaskId) is not { } task)
            return "Refused: no task has that taskId. Use find_tasks to get the id.";

        var fields = new List<FieldChange>();
        var patch = new TaskPatch();

        if (!string.IsNullOrWhiteSpace(input.Title) && input.Title.Trim() != task.Title)
        {
            var title = input.Title.Trim();
            if (title.Length > MaxTitleLength)
                return $"Refused: a title can be at most {MaxTitleLength} characters.";
            patch = patch with { Title = title };
            fields.Add(new("title", task.Title, title));
        }
        if (input.Notes is { } notes && notes.Trim() != (task.Notes ?? ""))
        {
            if (notes.Length > 10000)
                return "Refused: notes can be at most 10,000 characters.";
            patch = patch with { Notes = notes.Trim() };
            fields.Add(new("notes", task.Notes, notes.Trim()));
        }
        if (input.ClearDueDate == true)
        {
            if (task.DueDate is not null)
            {
                patch = patch with { ClearDueDate = true };
                fields.Add(new("dueDate", Day(task.DueDate.Value), null));
            }
        }
        else if (!string.IsNullOrWhiteSpace(input.DueDate))
        {
            if (ParseDay(input.DueDate) is not { } due)
                return "Refused: dueDate must be yyyy-MM-dd.";
            if (due != task.DueDate)
            {
                patch = patch with { DueDate = due };
                fields.Add(new("dueDate", task.DueDate is { } d ? Day(d) : null, Day(due)));
            }
        }
        if (!string.IsNullOrWhiteSpace(input.Status))
        {
            if (!TryParseState(input.Status, out var state))
                return "Refused: status must be todo, in_progress or done.";
            if (state != task.Status)
            {
                patch = patch with { Status = state };
                fields.Add(new("status", Snake(task.Status), Snake(state)));
            }
        }
        if (!string.IsNullOrWhiteSpace(input.Priority))
        {
            if (!Enum.TryParse<TaskPriority>(input.Priority, true, out var priority) || !Enum.IsDefined(priority))
                return "Refused: priority must be low, normal or high.";
            if (priority != task.Priority)
            {
                patch = patch with { Priority = priority };
                fields.Add(new("priority", Snake(task.Priority), Snake(priority)));
            }
        }

        if (fields.Count == 0)
            return "Nothing to change: the task already has those values.";

        // One change per task: a second proposal for the same task replaces the first.
        var existing = _changes.FindIndex(c => c.Kind == "task_update" && c.TargetId == task.Id);
        var change = new AssistantChange(existing >= 0 ? _changes[existing].Id : NextId(), "task_update", task.Title, fields, null,
            task.Id, task.UpdatedAt, patch, null, null, null);
        if (existing >= 0)
            _changes[existing] = change;
        else
            _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    public record ProposeTaskCreateInput(string? Title, string? Notes, string? DueDate, string? Priority, string? Area, string? Category, string? DelegatedTo);

    public string ProposeTaskCreate(ProposeTaskCreateInput input)
    {
        var title = input.Title?.Trim() ?? "";
        if (title.Length is 0 or > MaxTitleLength)
            return $"Refused: a title is required, at most {MaxTitleLength} characters.";
        var area = input.Area?.Equals("work", StringComparison.OrdinalIgnoreCase) == true ? TaskArea.Work : TaskArea.Personal;
        string? category = null;
        if (area == TaskArea.Work)
        {
            category = Settings.WorkCategories.FirstOrDefault(c => c.Equals(input.Category?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (category is null)
                return $"Refused: a work task needs a category, one of: {string.Join(", ", Settings.WorkCategories)}.";
        }
        DateOnly? due = null;
        if (!string.IsNullOrWhiteSpace(input.DueDate))
        {
            due = ParseDay(input.DueDate);
            if (due is null)
                return "Refused: dueDate must be yyyy-MM-dd.";
        }
        var priority = TaskPriority.Normal;
        if (!string.IsNullOrWhiteSpace(input.Priority) && (!Enum.TryParse(input.Priority, true, out priority) || !Enum.IsDefined(priority)))
            return "Refused: priority must be low, normal or high.";

        var draft = new NewTaskDraft(title, string.IsNullOrWhiteSpace(input.Notes) ? null : input.Notes.Trim(), due, priority, area, category,
            string.IsNullOrWhiteSpace(input.DelegatedTo) ? null : input.DelegatedTo.Trim());
        var fields = new List<FieldChange> { new("area", null, Snake(area)) };
        if (category is not null) fields.Add(new("category", null, category));
        if (due is { } d) fields.Add(new("dueDate", null, Day(d)));
        if (priority != TaskPriority.Normal) fields.Add(new("priority", null, Snake(priority)));
        if (draft.DelegatedTo is { } person) fields.Add(new("delegatedTo", null, person));
        if (draft.Notes is { } n) fields.Add(new("notes", null, n));

        var change = new AssistantChange(NextId(), "task_create", title, fields, null, null, null, null, draft, null, null);
        _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    public record ProposeTaskActivityInput(string? TaskId, string? Text);

    public string ProposeTaskActivity(ProposeTaskActivityInput input)
    {
        if (FindTask(input.TaskId) is not { } task)
            return "Refused: no task has that taskId. Use find_tasks to get the id.";
        var text = input.Text?.Trim() ?? "";
        if (text.Length is 0 or > MaxTextLength)
            return $"Refused: the activity line must be 1–{MaxTextLength} characters.";
        var change = new AssistantChange(NextId(), "task_activity", task.Title, [], text, task.Id, task.UpdatedAt, null, null, null, null);
        _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    public record ProposeProjectUpdateInput(string? ProjectId, string? Activity, string? Health);

    public string ProposeProjectUpdate(ProposeProjectUpdateInput input)
    {
        if (!Guid.TryParse(input.ProjectId, out var id) || Projects.FirstOrDefault(p => p.Id == id) is not { } project)
            return ArchivedProjects.Any(p => p.Id == id)
                ? "Refused: that project is archived. Only restore it if the user asked to."
                : "Refused: no project has that projectId. Use find_projects to get the id.";
        var text = string.IsNullOrWhiteSpace(input.Activity) ? null : input.Activity.Trim();
        if (text?.Length > MaxTextLength)
            return $"Refused: the activity line can be at most {MaxTextLength} characters.";
        ProjectHealth? health = null;
        if (!string.IsNullOrWhiteSpace(input.Health))
        {
            if (!Enum.TryParse<ProjectHealth>(input.Health.Replace("_", ""), true, out var parsed) || !Enum.IsDefined(parsed))
                return "Refused: health must be on_track, needs_attention or blocked.";
            if (parsed != project.Health)
                health = parsed;
        }
        if (text is null && health is null)
            return "Refused: give an activity line, a new health, or both.";

        var fields = health is { } h ? new List<FieldChange> { new("health", Snake(project.Health), Snake(h)) } : [];
        var change = new AssistantChange(NextId(), "project_update", project.Name, fields, text, project.Id, project.UpdatedAt, null, null, health, null);
        _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    // Restore: bring an archived project back to the board instead of archiving one.
    public record ProposeProjectArchiveInput(string? ProjectId, bool? Restore);

    public string ProposeProjectArchive(ProposeProjectArchiveInput input)
    {
        var restore = input.Restore == true;
        if (!Guid.TryParse(input.ProjectId, out var id)
            || (restore ? ArchivedProjects : Projects).FirstOrDefault(p => p.Id == id) is not { } project)
            return restore
                ? "Refused: no archived project has that projectId. Use find_projects with archived: true to get the id."
                : "Refused: no project on the board has that projectId. Use find_projects to get the id.";
        _changes.RemoveAll(c => c.TargetId == id && c.Kind is "project_archive" or "project_restore");
        var change = new AssistantChange(NextId(), restore ? "project_restore" : "project_archive", project.Name, [], null, project.Id, project.UpdatedAt, null, null, null, null);
        _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    public record ProposeWorkoutInput(string? Date, string? CategoryId, string? Activity, List<string>? Items, int? DurationMinutes, double? DistanceMiles, string? Notes);

    public string ProposeWorkout(ProposeWorkoutInput input)
    {
        var date = string.IsNullOrWhiteSpace(input.Date) ? Today : ParseDay(input.Date);
        if (date is null)
            return "Refused: date must be yyyy-MM-dd.";
        if (date > Today.AddDays(1) || date < Today.AddDays(-60))
            return "Refused: a workout date must be within the last 60 days.";
        var category = WorkoutConfig.Categories.FirstOrDefault(c => c.Id == input.CategoryId)
            ?? WorkoutConfig.Categories.FirstOrDefault(c => c.Name.Equals(input.CategoryId, StringComparison.OrdinalIgnoreCase));
        if (category is null)
            return $"Refused: categoryId must be one of: {string.Join(", ", WorkoutConfig.Categories.Select(c => c.Id))}.";
        var notes = string.IsNullOrWhiteSpace(input.Notes) ? null : input.Notes.Trim();
        if (notes?.Length > MaxTextLength)
            return $"Refused: notes can be at most {MaxTextLength} characters.";

        WorkoutDraft draft;
        string title;
        var fields = new List<FieldChange> { new("date", null, Day(date.Value)) };
        if (category.Kind == WorkoutKind.Activity)
        {
            var activity = input.Activity?.Trim() ?? "";
            if (category.Items.Count > 0)
            {
                var match = category.Items.FirstOrDefault(i => i.Equals(activity, StringComparison.OrdinalIgnoreCase));
                if (match is null)
                    return $"Refused: {category.Name}'s activities are {string.Join(", ", category.Items)}. Pick one of them, or use a category without a fixed list (such as Other) with the activity's name.";
                activity = match;
            }
            if (activity.Length is 0 or > 60)
                return "Refused: name the activity (up to 60 characters).";
            if (input.DurationMinutes is not (>= 1 and <= 1440))
                return "Refused: durationMinutes (1–1440) is required for this category. If the user didn't say how long, ask them.";
            if (input.DistanceMiles is { } miles && miles is not (> 0 and <= 1000))
                return "Refused: distanceMiles must be more than 0 and at most 1000.";
            draft = new(date.Value, category.Id, activity, [], input.DurationMinutes, input.DistanceMiles is { } m ? Math.Round(m, 2) : null, notes);
            title = $"{category.Name}: {activity}";
            fields.Add(new("durationMinutes", null, input.DurationMinutes.Value.ToString(CultureInfo.InvariantCulture)));
            if (draft.DistanceMiles is { } dist)
                fields.Add(new("distanceMiles", null, dist.ToString(CultureInfo.InvariantCulture)));
        }
        else
        {
            var items = new List<string>();
            foreach (var item in input.Items ?? [])
            {
                var match = category.Items.FirstOrDefault(i => i.Equals(item.Trim(), StringComparison.OrdinalIgnoreCase));
                if (match is null)
                    return $"Refused: \"{item}\" isn't on {category.Name}'s list ({string.Join(", ", category.Items)}). Use the closest ones from the list, and put anything else in notes.";
                if (!items.Contains(match))
                    items.Add(match);
            }
            if (items.Count == 0)
                return $"Refused: tick at least one of {string.Join(", ", category.Items)}.";
            draft = new(date.Value, category.Id, null, items, null, null, notes);
            title = $"{category.Name}: {string.Join(", ", items)}";
        }
        if (notes is not null)
            fields.Add(new("notes", null, notes));

        var change = new AssistantChange(NextId(), "workout_create", title, fields, null, null, null, null, null, null, draft);
        _changes.Add(change);
        return $"Recorded as {change.Id}.";
    }

    public record RemoveChangeInput(string? ChangeId);

    public string RemoveChange(RemoveChangeInput input) =>
        _changes.RemoveAll(c => c.Id == input.ChangeId) > 0 ? $"Removed {input.ChangeId}." : "No change has that id.";

    // ---------- for the prompt ----------

    // The draft as the model sees it when you refine: the id and what each change does.
    public string DescribeDraft() => _changes.Count == 0
        ? "(empty)"
        : string.Join("\n", _changes.Select(c => $"- {c.Id}: {Describe(c)}"));

    public static string Describe(AssistantChange c) => c.Kind switch
    {
        "task_update" => $"update task \"{c.Title}\" ({c.TargetId}): " + string.Join("; ", c.Fields.Select(f => $"{f.Field} {f.Before ?? "none"} → {f.After ?? "none"}")),
        "task_create" => $"add task \"{c.Title}\" " + string.Join("; ", c.Fields.Select(f => $"{f.Field} {f.After}")),
        "task_activity" => $"add to the activity of task \"{c.Title}\" ({c.TargetId}): \"{c.Text}\"",
        "project_update" => $"project \"{c.Title}\" ({c.TargetId}):" + (c.Text is null ? "" : $" add activity \"{c.Text}\"") +
            (c.Health is { } h ? $" set health {Snake(h)}" : ""),
        "workout_create" => $"log workout {c.Title}, " + string.Join("; ", c.Fields.Select(f => $"{f.Field} {f.After}")),
        _ => c.Kind,
    };

    // ---------- helpers ----------

    private string NextId() => $"c{_nextId++}";

    private TaskItem? FindTask(string? id) => Guid.TryParse(id, out var guid) ? Tasks.FirstOrDefault(t => t.Id == guid) : null;

    public static string Day(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static DateOnly? ParseDay(string? value) =>
        DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static string Snake<T>(T value) where T : struct, Enum => JsonNamingPolicy.SnakeCaseLower.ConvertName(value.ToString());

    private static bool TryParseState(string value, out TaskState state) =>
        Enum.TryParse(value.Replace("_", ""), ignoreCase: true, out state) && Enum.IsDefined(state);

    private static List<string> Words(string? text) =>
        (text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    private static bool Contains(string haystack, string word) => haystack.Contains(word, StringComparison.OrdinalIgnoreCase);

    private static string? Short(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Length <= max ? text : text[..max] + "…";
}
