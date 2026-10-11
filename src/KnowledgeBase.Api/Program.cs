using Google.Cloud.Firestore;
using KnowledgeBase.Api.Notes;

var builder = WebApplication.CreateBuilder(args);

// Cloud Run tells the container which port to listen on via $PORT (defaults to 8080).
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// Use Firestore when a project is configured (Cloud Run); otherwise keep notes in memory (local dev).
var firestoreProject = builder.Configuration["FIRESTORE_PROJECT_ID"];
if (!string.IsNullOrWhiteSpace(firestoreProject))
{
    builder.Services.AddSingleton(FirestoreDb.Create(firestoreProject));
    builder.Services.AddSingleton<INoteStore, FirestoreNoteStore>();
}
else
{
    builder.Services.AddSingleton<INoteStore, InMemoryNoteStore>();
}

var app = builder.Build();

var storage = string.IsNullOrWhiteSpace(firestoreProject) ? "in-memory" : "firestore";

app.MapGet("/", () => Results.Ok(new { service = "KnowledgeBase API", status = "running", storage }));

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTimeOffset.UtcNow }));

app.MapGet("/notes", async (INoteStore store) => Results.Ok(await store.ListAsync()));

app.MapGet("/notes/{id:guid}", async (Guid id, INoteStore store) =>
    await store.GetAsync(id) is { } note ? Results.Ok(note) : Results.NotFound());

app.MapPost("/notes", async (CreateNoteRequest request, INoteStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.Text))
        return Results.BadRequest(new { error = "Text is required." });

    var note = new Note(Guid.NewGuid(), request.Text.Trim(), DateTimeOffset.UtcNow);
    await store.AddAsync(note);
    return Results.Created($"/notes/{note.Id}", note);
});

app.MapDelete("/notes/{id:guid}", async (Guid id, INoteStore store) =>
    await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

app.Run();

record CreateNoteRequest(string Text);
