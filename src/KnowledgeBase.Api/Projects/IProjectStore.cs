namespace KnowledgeBase.Api.Projects;

// Serialized in snake_case: "small", "medium", "large". About 10%, 25% and 50% of one person's time.
public enum ProjectSize { Small, Medium, Large }

// Serialized "on_track", "needs_attention", "blocked".
public enum ProjectHealth { OnTrack, NeedsAttention, Blocked }

// A long-running work project on the Projects board. People are the team members carrying it ("You" is
// the owner); its size is split evenly between them for the capacity bars. LastCheckedIn is when it was
// last looked at; the board fades a project not checked in for two weeks.
public record Project(
    Guid Id,
    string Name,
    string Category,
    IReadOnlyList<string> People,
    ProjectSize Size,
    ProjectHealth Health,
    DateOnly? TargetDate,
    DateTimeOffset LastCheckedIn,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public interface IProjectStore
{
    Task<IReadOnlyList<Project>> ListAsync();
    Task<Project?> GetAsync(Guid id);
    Task AddAsync(Project project);
    Task UpdateAsync(Project project);
    Task<bool> DeleteAsync(Guid id);
}
