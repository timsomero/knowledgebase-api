using System.Xml.Linq;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.DataProtection.Repositories;

namespace KnowledgeBase.Api.Auth;

// Keeps ASP.NET Core's data-protection keys (which sign the session cookie) in the
// "dataProtectionKeys" collection, so sessions survive restarts and work on every
// Cloud Run instance. Deleting the collection signs every device out.
public class FirestoreXmlRepository(FirestoreDb db) : IXmlRepository
{
    private CollectionReference Keys => db.Collection("dataProtectionKeys");

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        var snapshot = Keys.GetSnapshotAsync().GetAwaiter().GetResult();
        return snapshot.Documents.Select(d => XElement.Parse(d.GetValue<string>("xml"))).ToList();
    }

    public void StoreElement(XElement element, string friendlyName) =>
        Keys.Document(friendlyName).SetAsync(new Dictionary<string, object>
        {
            ["xml"] = element.ToString(SaveOptions.DisableFormatting),
        }).GetAwaiter().GetResult();
}
