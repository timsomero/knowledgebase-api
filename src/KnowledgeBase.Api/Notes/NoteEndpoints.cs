using KnowledgeBase.Api.Photos;
using KnowledgeBase.Api.Tasks;

namespace KnowledgeBase.Api.Notes;

// Folder: null or empty means Unfiled. Pinned: null keeps it as it is (false for a new note).
public record SaveNoteRequest(string? Text, string? Folder, bool? Pinned);

// Folders: the ones you already have, so the suggestion can reuse one.
public record TidyNoteRequest(string? Text, IReadOnlyList<string>? Folders);

// To: the new name, or null or empty to move the folder's notes to Unfiled.
public record RenameFolderRequest(string? From, string? To);

public static class NoteEndpoints
{
    public const int MaxTextLength = 50000;
    public const int MaxFolderLength = 40;
    public const int MaxPhotosPerNote = 10;
    private const long MaxPhotoBytes = 8 * 1024 * 1024;
    private const long MaxThumbBytes = 1024 * 1024;

    public static void MapNoteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/notes", async (INoteStore store) => Results.Ok(await store.ListAsync()));

        app.MapGet("/notes/{id:guid}", async (Guid id, INoteStore store) =>
            await store.GetAsync(id) is { } note ? Results.Ok(note) : Results.NotFound());

        app.MapPost("/notes", async (SaveNoteRequest request, INoteStore store) =>
        {
            var (text, folder, error) = Read(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            var now = DateTimeOffset.UtcNow;
            var note = new Note(Guid.NewGuid(), text, folder, request.Pinned ?? false, [], now, now);
            await store.AddAsync(note);
            return Results.Created($"/notes/{note.Id}", note);
        });

        // Replaces the text and folder (and the pin, when given); photos and the date it was made stay.
        app.MapPut("/notes/{id:guid}", async (Guid id, SaveNoteRequest request, INoteStore store) =>
        {
            if (await store.GetAsync(id) is not { } before)
                return Results.NotFound();
            var (text, folder, error) = Read(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            var note = before with { Text = text, Folder = folder, Pinned = request.Pinned ?? before.Pinned, UpdatedAt = DateTimeOffset.UtcNow };
            await store.UpdateAsync(note);
            return Results.Ok(await store.GetAsync(id));
        });

        app.MapDelete("/notes/{id:guid}", async (Guid id, INoteStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } note)
                return Results.NotFound();
            await store.DeleteAsync(id);
            foreach (var photo in note.Photos)
                await DeleteFilesAsync(photos, id, photo.Id);
            return Results.NoContent();
        });

        // The Save panel: the note cleaned up and a suggested folder. Nothing is saved here.
        app.MapPost("/notes/tidy", async (TidyNoteRequest request, INoteAssistant assistant, CancellationToken cancellationToken) =>
        {
            var text = request.Text?.Trim() ?? "";
            if (text.Length == 0 || text.Length > MaxTextLength)
                return Results.BadRequest(new { error = $"Write a note of up to {MaxTextLength} characters." });
            var folders = (request.Folders ?? []).Where(f => !string.IsNullOrWhiteSpace(f)).Select(f => f.Trim()).Distinct().Take(100).ToList();
            var tidy = await assistant.TidyAsync(text, folders, cancellationToken);
            return Results.Ok(new { assisted = tidy is not null, text = tidy?.Text ?? text, folder = tidy?.Folder });
        });

        // Renames a folder on every note in it, or moves them all to Unfiled. Answers with how many moved.
        app.MapPost("/notes/folders/rename", async (RenameFolderRequest request, INoteStore store) =>
        {
            var from = request.From?.Trim();
            var to = string.IsNullOrWhiteSpace(request.To) ? null : request.To.Trim();
            if (string.IsNullOrEmpty(from))
                return Results.BadRequest(new { error = "Say which folder." });
            if (to?.Length > MaxFolderLength)
                return Results.BadRequest(new { error = $"A folder name can be up to {MaxFolderLength} characters." });

            var moved = 0;
            foreach (var note in await store.ListAsync())
            {
                if (!string.Equals(note.Folder, from, StringComparison.OrdinalIgnoreCase))
                    continue;
                await store.UpdateAsync(note with { Folder = to });
                moved++;
            }
            return Results.Ok(new { moved });
        });

        // Photos, as on tasks: multipart "photo" (about 2000 px) and "thumb" (about 400 px) JPEGs.
        app.MapPost("/notes/{id:guid}/photos", async (Guid id, IFormFile? photo, IFormFile? thumb, INoteStore store, IPhotoStore photos) =>
        {
            if (!photos.Enabled)
                return Results.BadRequest(new { error = "Photos are not set up on this server." });
            if (await store.GetAsync(id) is not { } note)
                return Results.NotFound();
            if (note.Photos.Count >= MaxPhotosPerNote)
                return Results.BadRequest(new { error = $"A note can have at most {MaxPhotosPerNote} photos." });

            var image = await TaskPhotoEndpoints.ReadJpegAsync(photo, MaxPhotoBytes);
            var preview = await TaskPhotoEndpoints.ReadJpegAsync(thumb, MaxThumbBytes);
            if (image is null || preview is null)
                return Results.BadRequest(new { error = "Send a JPEG \"photo\" (up to 8 MB) and \"thumb\" (up to 1 MB)." });

            var added = new NotePhoto(Guid.NewGuid(), image.Length, DateTimeOffset.UtcNow);
            await photos.SaveAsync(FileName(id, added.Id, thumb: false), image, "image/jpeg");
            await photos.SaveAsync(FileName(id, added.Id, thumb: true), preview, "image/jpeg");
            if (!await store.AddPhotoAsync(id, added))
            {
                await DeleteFilesAsync(photos, id, added.Id);
                return Results.NotFound();
            }
            return Results.Created($"/notes/{id}/photos/{added.Id}", await store.GetAsync(id));
        }).DisableAntiforgery(); // the session cookie is SameSite=Strict, so other sites can't post here

        app.MapGet("/notes/{id:guid}/photos/{photoId:guid}", async (Guid id, Guid photoId, string? size, HttpContext ctx, INoteStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } note || note.Photos.All(p => p.Id != photoId))
                return Results.NotFound();
            if (await photos.ReadAsync(FileName(id, photoId, thumb: size == "thumb")) is not { } data)
                return Results.NotFound();

            ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            return Results.File(data, "image/jpeg");
        });

        app.MapDelete("/notes/{id:guid}/photos/{photoId:guid}", async (Guid id, Guid photoId, INoteStore store, IPhotoStore photos) =>
        {
            if (await store.GetAsync(id) is not { } note || note.Photos.All(p => p.Id != photoId))
                return Results.NotFound();

            await store.RemovePhotoAsync(id, photoId);
            await DeleteFilesAsync(photos, id, photoId);
            return Results.Ok(await store.GetAsync(id));
        });
    }

    private static (string Text, string? Folder, string? Error) Read(SaveNoteRequest request)
    {
        var text = request.Text?.TrimEnd() ?? "";
        var folder = string.IsNullOrWhiteSpace(request.Folder) ? null : request.Folder.Trim();
        if (text.Trim().Length == 0)
            return ("", null, "Write something first.");
        if (text.Length > MaxTextLength)
            return ("", null, $"A note can be up to {MaxTextLength} characters.");
        if (folder?.Length > MaxFolderLength)
            return ("", null, $"A folder name can be up to {MaxFolderLength} characters.");
        return (text, folder, null);
    }

    private static async Task DeleteFilesAsync(IPhotoStore photos, Guid noteId, Guid photoId)
    {
        await photos.DeleteAsync(FileName(noteId, photoId, thumb: false));
        await photos.DeleteAsync(FileName(noteId, photoId, thumb: true));
    }

    private static string FileName(Guid noteId, Guid photoId, bool thumb) =>
        $"notes/{noteId}/{photoId}{(thumb ? "-thumb" : "")}.jpg";
}
