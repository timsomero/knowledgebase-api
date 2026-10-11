using Google.Cloud.Firestore;
using KnowledgeBase.Api.Notes;
using Microsoft.AspNetCore.Http.HttpResults;

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

builder.Services.AddOpenApi();

var app = builder.Build();

// API description at /openapi/v1.json and an interactive UI at /swagger.
// Safe to expose: Cloud Run only lets signed-in Google accounts reach the service at all.
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "KnowledgeBase API v1");
    options.DocumentTitle = "KnowledgeBase API";
});

var storage = string.IsNullOrWhiteSpace(firestoreProject) ? "in-memory" : "firestore";

app.MapGet("/", () => Results.Ok(new { service = "KnowledgeBase API", status = "running", storage }))
    .WithSummary("Service info, including which storage is active")
    .WithTags("Service");

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTimeOffset.UtcNow }))
    .WithSummary("Health check")
    .WithTags("Service");

var notes = app.MapGroup("/notes").WithTags("Notes");

notes.MapGet("", async (INoteStore store) => TypedResults.Ok(await store.ListAsync()))
    .WithSummary("List all notes, oldest first");

notes.MapGet("/{id:guid}", async Task<Results<Ok<Note>, NotFound>> (Guid id, INoteStore store) =>
        await store.GetAsync(id) is { } note ? TypedResults.Ok(note) : TypedResults.NotFound())
    .WithSummary("Get one note");

notes.MapPost("", async Task<Results<Created<Note>, BadRequest<ErrorResponse>>> (CreateNoteRequest request, INoteStore store) =>
    {
        if (string.IsNullOrWhiteSpace(request.Text))
            return TypedResults.BadRequest(new ErrorResponse("Text is required."));

        var note = new Note(Guid.NewGuid(), request.Text.Trim(), DateTimeOffset.UtcNow);
        await store.AddAsync(note);
        return TypedResults.Created($"/notes/{note.Id}", note);
    })
    .WithSummary("Create a note");

notes.MapDelete("/{id:guid}", async Task<Results<NoContent, NotFound>> (Guid id, INoteStore store) =>
        await store.DeleteAsync(id) ? TypedResults.NoContent() : TypedResults.NotFound())
    .WithSummary("Delete a note");

app.Run();

record CreateNoteRequest(string Text);

record ErrorResponse(string Error);
