using System.Text.Json;
using System.Text.Json.Serialization;
using Google.Cloud.Firestore;
using KnowledgeBase.Api.Notes;
using KnowledgeBase.Api.Tasks;
using Microsoft.AspNetCore.Authentication.JwtBearer;

var builder = WebApplication.CreateBuilder(args);

// Cloud Run tells the container which port to listen on via $PORT (defaults to 8080).
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// Use Firestore when a project is configured (Cloud Run); otherwise keep notes in memory (local dev).
var firestoreProject = builder.Configuration["FIRESTORE_PROJECT_ID"];
if (!string.IsNullOrWhiteSpace(firestoreProject))
{
    builder.Services.AddSingleton(_ => FirestoreDb.Create(firestoreProject));
    builder.Services.AddSingleton<INoteStore, FirestoreNoteStore>();
    builder.Services.AddSingleton<ITaskStore, FirestoreTaskStore>();
}
else
{
    builder.Services.AddSingleton<INoteStore, InMemoryNoteStore>();
    builder.Services.AddSingleton<ITaskStore, InMemoryTaskStore>();
}

// Sign-in: the service is public, so /notes and /tasks need a Google ID token whose
// (verified) email is in ALLOWED_EMAILS (comma-separated). Tokens are accepted from the
// web app's OAuth client (GOOGLE_CLIENT_ID) and from `gcloud auth print-identity-token`.
const string GcloudClientId = "32555940559.apps.googleusercontent.com";
var googleClientId = builder.Configuration["GOOGLE_CLIENT_ID"];
var allowedEmails = (builder.Configuration["ALLOWED_EMAILS"] ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
var authEnabled = allowedEmails.Count > 0;

// Without an allowlist anyone could read the data, which is only acceptable for in-memory local dev.
if (!authEnabled && !string.IsNullOrWhiteSpace(firestoreProject))
    throw new InvalidOperationException("ALLOWED_EMAILS must be set when FIRESTORE_PROJECT_ID is set.");

if (authEnabled)
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = "https://accounts.google.com";
            options.MapInboundClaims = false;
            options.TokenValidationParameters.ValidIssuers = ["https://accounts.google.com", "accounts.google.com"];
            options.TokenValidationParameters.ValidAudiences =
                new[] { googleClientId, GcloudClientId }.Where(a => !string.IsNullOrWhiteSpace(a)).Cast<string>().ToList();
        });

    builder.Services.AddAuthorizationBuilder().AddPolicy("owner", policy => policy
        .RequireAuthenticatedUser()
        .RequireClaim("email_verified", "true")
        .RequireAssertion(ctx => ctx.User.FindFirst("email")?.Value is { } email && allowedEmails.Contains(email)));
}

// Enums go over the wire as snake_case strings, e.g. "in_progress".
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)));

var app = builder.Build();

// The web app (wwwroot) is served at "/".
app.UseDefaultFiles();
app.UseStaticFiles();

if (authEnabled)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

var storage = string.IsNullOrWhiteSpace(firestoreProject) ? "in-memory" : "firestore";

app.MapGet("/info", () => Results.Ok(new { service = "KnowledgeBase API", status = "running", storage, authEnabled }));

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTimeOffset.UtcNow }));

// Lets the web app know which Google OAuth client to sign in with.
app.MapGet("/config", () => Results.Ok(new { authEnabled, googleClientId }));

var api = app.MapGroup("");
if (authEnabled)
    api.RequireAuthorization("owner");

api.MapGet("/notes", async (INoteStore store) => Results.Ok(await store.ListAsync()));

api.MapGet("/notes/{id:guid}", async (Guid id, INoteStore store) =>
    await store.GetAsync(id) is { } note ? Results.Ok(note) : Results.NotFound());

api.MapPost("/notes", async (CreateNoteRequest request, INoteStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.Text))
        return Results.BadRequest(new { error = "Text is required." });

    var note = new Note(Guid.NewGuid(), request.Text.Trim(), DateTimeOffset.UtcNow);
    await store.AddAsync(note);
    return Results.Created($"/notes/{note.Id}", note);
});

api.MapDelete("/notes/{id:guid}", async (Guid id, INoteStore store) =>
    await store.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

api.MapTaskEndpoints();

app.Run();

record CreateNoteRequest(string Text);
