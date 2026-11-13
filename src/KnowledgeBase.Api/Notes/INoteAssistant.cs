namespace KnowledgeBase.Api.Notes;

// What the assistant makes of a note: the text cleaned up (typos, punctuation, speech-to-text slips, the
// meaning and every detail kept), the same in Html with the note's formatting kept when it was given some
// (null otherwise; the web app cleans it again before showing it), and the folder it fits, one of the folders
// it was given or a short new name; null when nothing fits.
public record NoteTidy(string Text, string? Html, string? Folder);

public interface INoteAssistant
{
    // Null when the assistant can't be reached or gives no usable answer; the note is then filed by hand.
    Task<NoteTidy?> TidyAsync(string text, string? html, IReadOnlyList<string> folders, CancellationToken cancellationToken);
}

// Used on Cloud Run until ANTHROPIC_API_KEY is set: notes are saved as typed and filed by hand.
public class DisabledNoteAssistant : INoteAssistant
{
    public Task<NoteTidy?> TidyAsync(string text, string? html, IReadOnlyList<string> folders, CancellationToken cancellationToken) =>
        Task.FromResult<NoteTidy?>(null);
}

// A stand-in for local in-memory runs, so the Save panel can be tried without a key: trims the text,
// capitalises its first letter, keeps any formatting as it is, and suggests the first folder named in it.
public class LocalNoteAssistant : INoteAssistant
{
    public Task<NoteTidy?> TidyAsync(string text, string? html, IReadOnlyList<string> folders, CancellationToken cancellationToken)
    {
        var tidied = text.Trim();
        if (tidied.Length > 0)
            tidied = char.ToUpper(tidied[0]) + tidied[1..];
        var folder = folders.FirstOrDefault(f => text.Contains(f, StringComparison.OrdinalIgnoreCase));
        return Task.FromResult<NoteTidy?>(new NoteTidy(tidied, html, folder));
    }
}
