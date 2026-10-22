using System.Collections.Concurrent;

namespace KnowledgeBase.Api.Photos;

// Image files, by name (e.g. "tasks/<task id>/<photo id>.jpg"). What they belong to is kept in Firestore.
public interface IPhotoStore
{
    // False when no bucket is configured; the web app then hides photos.
    bool Enabled { get; }

    Task SaveAsync(string name, byte[] data, string contentType);

    // Null when there is no such file.
    Task<byte[]?> ReadAsync(string name);

    // Does nothing when there is no such file.
    Task DeleteAsync(string name);
}

// Used for local development; photos are lost when the process stops.
public class InMemoryPhotoStore : IPhotoStore
{
    private readonly ConcurrentDictionary<string, byte[]> _files = new();

    public bool Enabled => true;

    public Task SaveAsync(string name, byte[] data, string contentType)
    {
        _files[name] = data;
        return Task.CompletedTask;
    }

    public Task<byte[]?> ReadAsync(string name) =>
        Task.FromResult(_files.TryGetValue(name, out var data) ? data : null);

    public Task DeleteAsync(string name)
    {
        _files.TryRemove(name, out _);
        return Task.CompletedTask;
    }
}

// Used on Cloud Run until PHOTO_BUCKET is set (see setup-photos.sh).
public class DisabledPhotoStore : IPhotoStore
{
    public bool Enabled => false;

    public Task SaveAsync(string name, byte[] data, string contentType) =>
        throw new InvalidOperationException("Photos are not set up: PHOTO_BUCKET is not set.");

    public Task<byte[]?> ReadAsync(string name) => Task.FromResult<byte[]?>(null);

    public Task DeleteAsync(string name) => Task.CompletedTask;
}
