# Build stage: compile with the full .NET SDK
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/KnowledgeBase.Api/KnowledgeBase.Api.csproj src/KnowledgeBase.Api/
RUN dotnet restore src/KnowledgeBase.Api/KnowledgeBase.Api.csproj
COPY src/ src/
RUN dotnet publish src/KnowledgeBase.Api/KnowledgeBase.Api.csproj -c Release -o /app --no-restore

# Runtime stage: small ASP.NET image, runs as non-root
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
# Build number and commit, shown in small print in the app. Deploys pass them; local builds show "dev".
ARG APP_BUILD=dev
ARG APP_COMMIT=local
WORKDIR /app
COPY --from=build /app .
RUN sed -i "s/__APP_BUILD__/${APP_BUILD}/g; s/__APP_COMMIT__/${APP_COMMIT}/g" wwwroot/index.html
ENV APP_BUILD=$APP_BUILD APP_COMMIT=$APP_COMMIT
USER $APP_UID
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "KnowledgeBase.Api.dll"]
