using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);

// Cloud Run tells the container which port to listen on via $PORT (defaults to 8080).
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();

// Temporary in-memory store; will be replaced by a real Google Cloud database later.
var notes = new ConcurrentDictionary<Guid, Note>();

app.MapGet("/", () => Results.Ok(new { service = "KnowledgeBase API", status = "running" }));

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTimeOffset.UtcNow }));

app.MapGet("/notes", () => Results.Ok(notes.Values.OrderBy(n => n.CreatedAt)));

app.MapGet("/notes/{id:guid}", (Guid id) =>
    notes.TryGetValue(id, out var note) ? Results.Ok(note) : Results.NotFound());

app.MapPost("/notes", (CreateNoteRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Text))
        return Results.BadRequest(new { error = "Text is required." });

    var note = new Note(Guid.NewGuid(), request.Text.Trim(), DateTimeOffset.UtcNow);
    notes[note.Id] = note;
    return Results.Created($"/notes/{note.Id}", note);
});

app.MapDelete("/notes/{id:guid}", (Guid id) =>
    notes.TryRemove(id, out _) ? Results.NoContent() : Results.NotFound());

app.Run();

record Note(Guid Id, string Text, DateTimeOffset CreatedAt);

record CreateNoteRequest(string Text);
