namespace KnowledgeBase.Api.Projects;

// Serialized in snake_case: "small", "medium", "large". Only sets the order on the board (bigger first).
public enum ProjectSize { Small, Medium, Large }

// Serialized "on_track", "needs_attention", "blocked".
public enum ProjectHealth { OnTrack, NeedsAttention, Blocked }

// A long-running work project on the Projects board. Goal is what it is for, in a sentence (it heads the
// project in the leadership report); Notes hold the standing details (scope, contacts, links); Log is its dated activity, oldest first. LastCheckedIn is when it was last looked at; the board
// fades a project not checked in for two weeks.
public record Project(
    Guid Id,
    string Name,
    string Category,
    ProjectSize Size,
    ProjectHealth Health,
    DateOnly? TargetDate,
    string? Notes,
    string? Goal,
    IReadOnlyList<ProjectLogEntry> Log,
    DateTimeOffset LastCheckedIn,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

// One line of a project's activity: something you wrote, or (Auto) a change the app recorded, like
// "Checked in" or "Health: On track → Blocked".
public record ProjectLogEntry(Guid Id, DateTimeOffset At, string Text, bool Auto);

public interface IProjectStore
{
    Task<IReadOnlyList<Project>> ListAsync();
    Task<Project?> GetAsync(Guid id);
    Task AddAsync(Project project);
    // Saves every field except Log, which only changes through the two methods below, so an edit never
    // undoes a log entry added at the same moment.
    Task UpdateAsync(Project project);
    // False when the project doesn't exist.
    Task<bool> AddLogAsync(Guid projectId, ProjectLogEntry entry);
    Task<bool> RemoveLogAsync(Guid projectId, Guid entryId);
    Task<bool> DeleteAsync(Guid id);
}
