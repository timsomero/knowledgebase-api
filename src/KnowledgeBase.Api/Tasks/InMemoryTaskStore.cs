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
        lock (_tasks)
            _tasks[task.Id] = _tasks.TryGetValue(task.Id, out var current) ? task with { Photos = current.Photos } : task;
        return Task.CompletedTask;
    }

    public Task<bool> AddPhotoAsync(Guid taskId, TaskPhoto photo) =>
        Task.FromResult(ChangePhotos(taskId, photos => [.. photos, photo]));

    public Task<bool> RemovePhotoAsync(Guid taskId, Guid photoId) =>
        Task.FromResult(ChangePhotos(taskId, photos => photos.Where(p => p.Id != photoId).ToList()));

    private bool ChangePhotos(Guid taskId, Func<IReadOnlyList<TaskPhoto>, IReadOnlyList<TaskPhoto>> change)
    {
        lock (_tasks)
        {
            if (!_tasks.TryGetValue(taskId, out var task))
                return false;
            _tasks[taskId] = task with { Photos = change(task.Photos) };
            return true;
        }
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_tasks.TryRemove(id, out _));
}
