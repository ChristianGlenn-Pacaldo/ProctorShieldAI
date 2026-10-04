// A bootstrap response sets only browser identity. Retry once after fetch has
// processed its Set-Cookie headers; never loop if cookies are blocked.
export async function fetchAuth(fetcher: typeof fetch, url: string, init: RequestInit) {
  const response = await fetcher(url, init);
  if (response.status === 409 && (await response.clone().json().catch(() => null))?.code === "BROWSER_AUTH_INITIALIZED") {
    if (init.signal?.aborted) return response;
    return fetcher(url, init);
  }
  return response;
}
