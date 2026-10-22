using System.Net;
using Google;
using Google.Cloud.Storage.V1;

namespace KnowledgeBase.Api.Photos;

// Keeps photos in a private Cloud Storage bucket (PHOTO_BUCKET). Only the service's own account can
// read or write it; the app serves the images itself, after its sign-in check.
public class CloudStoragePhotoStore(StorageClient storage, string bucket) : IPhotoStore
{
    public bool Enabled => true;

    public async Task SaveAsync(string name, byte[] data, string contentType)
    {
        using var stream = new MemoryStream(data);
        await storage.UploadObjectAsync(bucket, name, contentType, stream);
    }

    public async Task<byte[]?> ReadAsync(string name)
    {
        try
        {
            using var stream = new MemoryStream();
            await storage.DownloadObjectAsync(bucket, name, stream);
            return stream.ToArray();
        }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task DeleteAsync(string name)
    {
        try
        {
            await storage.DeleteObjectAsync(bucket, name);
        }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound)
        {
        }
    }
}
