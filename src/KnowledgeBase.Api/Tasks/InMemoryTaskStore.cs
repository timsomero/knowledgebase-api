using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Tasks;

// Used for local development; data is lost when the process stops.
public class InMemoryTaskStore : ITaskStore
{
    private readonly ConcurrentDictionary<Guid, TaskItem> _tasks = new();

    public Task<IReadOnlyList<TaskItem>> ListAsync() =>
        Task.FromResult<IReadOnlyList<TaskItem>>(_tasks.Values.OrderBy(t => t.CreatedAt).ToList());

    public Task<TaskItem?> GetAsync(Guid id) =>
        Task.FromResult(_tasks.TryGetValue(id, out var task) ? task : null);

    public Task AddAsync(TaskItem task)
    {
        _tasks[task.Id] = task;
        return Task.CompletedTask;
    }

    public Task UpdateAsync(TaskItem task)
    {
        _tasks[task.Id] = task;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_tasks.TryRemove(id, out _));
}
