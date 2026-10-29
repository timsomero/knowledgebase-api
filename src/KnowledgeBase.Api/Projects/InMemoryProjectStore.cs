using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Projects;

// Used for local development; data is lost when the process stops.
public class InMemoryProjectStore : IProjectStore
{
    private readonly ConcurrentDictionary<Guid, Project> _projects = new();

    public Task<IReadOnlyList<Project>> ListAsync() =>
        Task.FromResult<IReadOnlyList<Project>>(_projects.Values.OrderBy(p => p.CreatedAt).ToList());

    public Task<Project?> GetAsync(Guid id) =>
        Task.FromResult(_projects.TryGetValue(id, out var project) ? project : null);

    public Task AddAsync(Project project)
    {
        _projects[project.Id] = project;
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Project project)
    {
        lock (_projects)
            _projects[project.Id] = _projects.TryGetValue(project.Id, out var current) ? project with { Log = current.Log } : project;
        return Task.CompletedTask;
    }

    public Task<bool> AddLogAsync(Guid projectId, ProjectLogEntry entry) =>
        Task.FromResult(ChangeLog(projectId, log => [.. log, entry]));

    public Task<bool> RemoveLogAsync(Guid projectId, Guid entryId) =>
        Task.FromResult(ChangeLog(projectId, log => log.Where(e => e.Id != entryId).ToList()));

    private bool ChangeLog(Guid projectId, Func<IReadOnlyList<ProjectLogEntry>, IReadOnlyList<ProjectLogEntry>> change)
    {
        lock (_projects)
        {
            if (!_projects.TryGetValue(projectId, out var project))
                return false;
            _projects[projectId] = project with { Log = change(project.Log) };
            return true;
        }
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_projects.TryRemove(id, out _));
}
