# TFAssist (knowledgebase-api)

Personal task and workout app: one ASP.NET Core (.NET 10) service on Cloud Run that serves the web app
(`src/KnowledgeBase.Api/wwwroot`) and its API, stores data in Firestore, and signs in with Google.
See `docs/architecture.md` for how it fits together and `README.md` for endpoints, setup and deploys.

## Architecture docs

`docs/architecture.md` (renders on GitHub, Mermaid diagrams) and `docs/architecture.html` (the same
content as a styled page) are **not** updated for every small tweak. After adding a major feature or
making a significant architectural change (new service, storage, auth, deploy or infrastructure
change, new collection or screen area), **ask the owner whether to update these docs** before
finishing. Keep both files in step when they are updated, and refresh the commit noted at the top.

## Working conventions

- Changes go through a pull request into `main`; merging to `main` deploys automatically
  (`.github/workflows/deploy.yml`), so nothing reaches the live app without a merge.
- Agree on UI changes before coding; for new screens the owner likes to see mockups first.
- The only CI check is `dotnet build`. Before pushing, run the app locally with in-memory storage
  (`PORT=5096 dotnet run --project src/KnowledgeBase.Api`, no `FIRESTORE_PROJECT_ID`) and exercise
  the changed endpoints and screens.
- Match the existing style: minimal APIs with one `*Endpoints.cs` per area, a store interface with
  Firestore and in-memory implementations, plain JavaScript in `wwwroot` (no framework or build step).
