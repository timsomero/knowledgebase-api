using KnowledgeBase.Api.Photos;

namespace KnowledgeBase.Api.Tasks;

public static class TaskPhotoEndpoints
{
    public const int MaxPhotosPerTask = 10;
    private const long MaxPhotoBytes = 8 * 1024 * 1024;
    private const long MaxThumbBytes = 1024 * 1024;

    public static void MapTaskPhotoEndpoints(this IEndpointRouteBuilder app)
    {
        // multipart/form-data with two JPEG files: "photo" (the web app shrinks it to about 2000 px first)
        // and "thumb" (about 400 px, for the task's photo row). Answers with the updated task.
        app.MapPost("/tasks/{id:guid}/photos", async (Guid id, IFormFile? photo, IFormFile? thumb, ITaskStore store, IPhotoStore photos) =>
        {
            if (!photos.Enabled)
                return Results.BadRequest(new { error = "Photos are not set up on this server." });
            if (await store.GetAsync(id) is not { } task)
                return Results.NotFound();
            if (task.Photos.Count >= MaxPhotosPerTask)
                return Results.BadRequest(new { error = $"A task can have at most {MaxPhotosPerTask} photos." });

            var image = await ReadJpegAsync(photo, MaxPhotoBytes);
            var preview = await ReadJpegAsync(thumb, MaxThumbBytes);
            if (image is null || preview is null)
                return Results.BadRequest(new { error = "Send a JPEG \"photo\" (up to 8 MB) and \"thumb\" (up to 1 MB)." });

            var added = new TaskPhoto(Guid.NewGuid(), image.Length, DateTimeOffset.UtcNow);
            await photos.SaveAsync(FileName(id, added.Id, thumb: false), image, "image/jpeg");
            await photos.SaveAsync(FileName(id, added.Id, thumb: true), preview, "image/jpeg");
            if (!await store.AddPhotoAsync(id, added))
            {
                // The task was deleted while the photo uploaded.
                await DeleteFilesAsync(photos, id, added.Id);
                return Results.NotFound();
            }
            return Results.Created($"/tasks/{id}/photos/{added.Id}", await store.GetAsync(id));
        }).DisableAntiforgery(); // the session cookie is SameSite=Strict, so other sites can't post here

        // The image itself; ?size=thumb for the small one. Photos never change once added,
        // so the browser may keep them for good.
        app.MapGet("/tasks/{id:guid}/photos/{photoId:guid}", async (Guid id, Guid photoId, string? size, HttpContext ctx, ITaskStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } task || task.Photos.All(p => p.Id != photoId))
                return Results.NotFound();
            if (await photos.ReadAsync(FileName(id, photoId, thumb: size == "thumb")) is not { } data)
                return Results.NotFound();

            ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            return Results.File(data, "image/jpeg");
        });

        app.MapDelete("/tasks/{id:guid}/photos/{photoId:guid}", async (Guid id, Guid photoId, ITaskStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } task || task.Photos.All(p => p.Id != photoId))
                return Results.NotFound();

            await store.RemovePhotoAsync(id, photoId);
            await DeleteFilesAsync(photos, id, photoId);
            return Results.Ok(await store.GetAsync(id));
        });
    }

    // Removes a deleted task's photo files.
    public static async Task DeletePhotosAsync(IPhotoStore photos, TaskItem task)
    {
        foreach (var photo in task.Photos)
            await DeleteFilesAsync(photos, task.Id, photo.Id);
    }

    private static async Task DeleteFilesAsync(IPhotoStore photos, Guid taskId, Guid photoId)
    {
        await photos.DeleteAsync(FileName(taskId, photoId, thumb: false));
        await photos.DeleteAsync(FileName(taskId, photoId, thumb: true));
    }

    private static string FileName(Guid taskId, Guid photoId, bool thumb) =>
        $"tasks/{taskId}/{photoId}{(thumb ? "-thumb" : "")}.jpg";

    // The file's bytes if it is a JPEG within the size limit; checked by content, not by its name.
    private static async Task<byte[]?> ReadJpegAsync(IFormFile? file, long maxBytes)
    {
        if (file is null || file.Length is 0 || file.Length > maxBytes)
            return null;
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        var data = stream.ToArray();
        return data is [0xFF, 0xD8, 0xFF, ..] ? data : null;
    }
}
