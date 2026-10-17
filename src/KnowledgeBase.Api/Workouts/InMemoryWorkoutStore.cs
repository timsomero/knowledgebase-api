using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Workouts;

// Used for local development; data is lost when the process stops.
public class InMemoryWorkoutStore : IWorkoutStore
{
    private readonly ConcurrentDictionary<Guid, Workout> _workouts = new();

    public Task<IReadOnlyList<Workout>> ListAsync() =>
        Task.FromResult<IReadOnlyList<Workout>>(_workouts.Values.ToList());

    public Task<Workout?> GetAsync(Guid id) =>
        Task.FromResult(_workouts.TryGetValue(id, out var workout) ? workout : null);

    public Task AddAsync(Workout workout)
    {
        _workouts[workout.Id] = workout;
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Workout workout)
    {
        _workouts[workout.Id] = workout;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid id) => Task.FromResult(_workouts.TryRemove(id, out _));
}

public class InMemoryWorkoutConfigStore : IWorkoutConfigStore
{
    private WorkoutConfig _config = WorkoutConfig.Default;

    public Task<WorkoutConfig> GetAsync() => Task.FromResult(_config);

    public Task SaveAsync(WorkoutConfig config)
    {
        _config = config;
        return Task.CompletedTask;
    }
}
