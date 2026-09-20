/** Proxies and the framework may reject uploads with plain text or HTML. */
export async function readImageUploadResponse(
  response: Response,
): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const result =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!response.ok) {
    if (typeof result?.error === 'string' && result.error.trim()) {
      throw new Error(result.error);
    }
    if (response.status === 413) {
      throw new Error(
        'This image is too large to upload. Choose an image smaller than 5 MB.',
      );
    }
    if (response.status === 401) {
      throw new Error('Your session has expired. Log in again.');
    }
    throw new Error('The image could not be uploaded. Please try again.');
  }
  if (typeof result?.url !== 'string' || !result.url.trim()) {
    throw new Error(
      'The upload returned an invalid response. Please try again.',
    );
  }
  return result.url;
}
