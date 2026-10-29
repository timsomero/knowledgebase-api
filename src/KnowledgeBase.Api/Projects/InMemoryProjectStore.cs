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
        _projects[project.Id] = project;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_projects.TryRemove(id, out _));
}
