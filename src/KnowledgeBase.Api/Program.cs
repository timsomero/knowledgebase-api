using System.Security.Claims;
using Anthropic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Google.Cloud.Firestore;
using Google.Cloud.Storage.V1;
using KnowledgeBase.Api.Auth;
using KnowledgeBase.Api.Notes;
using KnowledgeBase.Api.Photos;
using KnowledgeBase.Api.Tasks;
using KnowledgeBase.Api.Workouts;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;

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
    builder.Services.AddSingleton<IWorkoutStore, FirestoreWorkoutStore>();
    builder.Services.AddSingleton<IWorkoutConfigStore, FirestoreWorkoutConfigStore>();
    builder.Services.AddOptions<KeyManagementOptions>()
        .Configure<FirestoreDb>((options, db) => options.XmlRepository = new FirestoreXmlRepository(db));
}
else
{
    builder.Services.AddSingleton<INoteStore, InMemoryNoteStore>();
    builder.Services.AddSingleton<ITaskStore, InMemoryTaskStore>();
    builder.Services.AddSingleton<IWorkoutStore, InMemoryWorkoutStore>();
    builder.Services.AddSingleton<IWorkoutConfigStore, InMemoryWorkoutConfigStore>();
}

// Task photos go to a private Cloud Storage bucket (PHOTO_BUCKET, see setup-photos.sh). Without it, photos
// are off on Cloud Run; local in-memory runs keep them in memory.
var photoBucket = builder.Configuration["PHOTO_BUCKET"];
if (!string.IsNullOrWhiteSpace(photoBucket))
    builder.Services.AddSingleton<IPhotoStore>(_ => new CloudStoragePhotoStore(StorageClient.Create(), photoBucket));
else if (string.IsNullOrWhiteSpace(firestoreProject))
    builder.Services.AddSingleton<IPhotoStore, InMemoryPhotoStore>();
else
    builder.Services.AddSingleton<IPhotoStore, DisabledPhotoStore>();

// Tidying up new tasks with Claude needs ANTHROPIC_API_KEY (a Secret Manager secret on Cloud Run, see
// setup-assistant.sh). Without it tasks are saved as typed; local in-memory runs get a simple stand-in.
var anthropicApiKey = builder.Configuration["ANTHROPIC_API_KEY"];
if (!string.IsNullOrWhiteSpace(anthropicApiKey))
{
    builder.Services.AddSingleton(_ => new AnthropicClient { ApiKey = anthropicApiKey });
    builder.Services.AddSingleton<ITaskAssistant, ClaudeTaskAssistant>();
}
else if (string.IsNullOrWhiteSpace(firestoreProject))
    builder.Services.AddSingleton<ITaskAssistant, LocalTaskAssistant>();
else
    builder.Services.AddSingleton<ITaskAssistant, DisabledTaskAssistant>();

// Sign-in: the service is public, so the API (/notes, /tasks, /workouts...) needs a signed-in user whose (verified)
// email is in ALLOWED_EMAILS (comma-separated). That is either:
//  - a session cookie, which the web app gets once by posting a Google ID token to /session.
//    It lasts 30 days and is renewed while the app is used, so Google's 1-hour token
//    lifetime doesn't sign you out; or
//  - a Google ID token on every request, from the web app's OAuth client (GOOGLE_CLIENT_ID)
//    or from `gcloud auth print-identity-token` (command-line use).
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
    builder.Services.AddDataProtection().SetApplicationName("knowledgebase-api");

    builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
        .AddCookie(options =>
        {
            options.Cookie.Name = "kb_session";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.ExpireTimeSpan = TimeSpan.FromDays(30);
            options.SlidingExpiration = true;
            // This is an API: answer 401/403 instead of redirecting to a login page.
            options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
        })
        .AddJwtBearer(options =>
        {
            options.Authority = "https://accounts.google.com";
            options.MapInboundClaims = false;
            options.TokenValidationParameters.ValidIssuers = ["https://accounts.google.com", "accounts.google.com"];
            options.TokenValidationParameters.ValidAudiences =
                new[] { googleClientId, GcloudClientId }.Where(a => !string.IsNullOrWhiteSpace(a)).Cast<string>().ToList();
        });

    void RequireAllowedEmail(AuthorizationPolicyBuilder policy) => policy
        .RequireAuthenticatedUser()
        .RequireClaim("email_verified", "true")
        .RequireAssertion(ctx => ctx.User.FindFirst("email")?.Value is { } email && allowedEmails.Contains(email));

    builder.Services.AddAuthorizationBuilder()
        // The API: session cookie or Google ID token.
        .AddPolicy("owner", policy => RequireAllowedEmail(policy
            .AddAuthenticationSchemes(CookieAuthenticationDefaults.AuthenticationScheme, JwtBearerDefaults.AuthenticationScheme)))
        // Starting a session: Google ID token only.
        .AddPolicy("google", policy => RequireAllowedEmail(policy
            .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)));
}

// Enums go over the wire as snake_case strings, e.g. "in_progress".
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)));

var app = builder.Build();

// The web app (wwwroot) is served at "/".
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Browsers check for a newer file on every load (a cheap 304 when unchanged), so a deploy
    // reaches phones right away instead of whenever a cached copy happens to expire.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

if (authEnabled)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

var storage = string.IsNullOrWhiteSpace(firestoreProject) ? "in-memory" : "firestore";
var assistant = app.Services.GetRequiredService<ITaskAssistant>().Enabled;
var photos = app.Services.GetRequiredService<IPhotoStore>().Enabled;

// Stamped into the image by the deploy (see Dockerfile); "dev" for local runs.
var version = new
{
    build = Environment.GetEnvironmentVariable("APP_BUILD") ?? "dev",
    commit = Environment.GetEnvironmentVariable("APP_COMMIT") ?? "local",
};

app.MapGet("/info", () => Results.Ok(new { service = "KnowledgeBase API", status = "running", storage, authEnabled, assistant, photos, version }));

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTimeOffset.UtcNow }));

// Lets the web app know which Google OAuth client to sign in with, whether new tasks get tidied up,
// and whether photos can be attached.
app.MapGet("/config", () => Results.Ok(new { authEnabled, googleClientId, assistant, photos, version }));

if (authEnabled)
{
    // Exchanges a Google ID token (Authorization: Bearer ...) for a session cookie.
    app.MapPost("/session", async (HttpContext ctx) =>
    {
        var email = ctx.User.FindFirst("email")!.Value;
        var identity = new ClaimsIdentity(
            [new Claim("email", email), new Claim("email_verified", "true")],
            CookieAuthenticationDefaults.AuthenticationScheme);
        await ctx.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
        return Results.Ok(new { email });
    }).RequireAuthorization("google");

    app.MapGet("/session", (HttpContext ctx) => Results.Ok(new { email = ctx.User.FindFirst("email")?.Value }))
        .RequireAuthorization("owner");

    app.MapDelete("/session", async (HttpContext ctx) =>
    {
        await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    });
}

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
api.MapTaskPhotoEndpoints();
api.MapWorkoutEndpoints();

app.Run();

record CreateNoteRequest(string Text);
