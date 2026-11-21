/**
 * Browser fetch wrapper that always throws an Error with a message safe to show to a person.
 * Handles network failure, non-JSON error pages (e.g. a 502 from the host) and { error } bodies.
 */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error("Can't reach the server. Check your internet connection and try again.");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (HTML error page, empty body).
  }

  if (!res.ok) {
    const apiMessage =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : null;
    if (apiMessage) throw new Error(apiMessage);
    if (res.status === 401 || res.status === 403) throw new Error("You don't have permission to do that. Try signing in again.");
    if (res.status >= 500) throw new Error("The server had a problem. Please try again in a moment.");
    throw new Error(`The request failed (${res.status}).`);
  }

  if (body === null) throw new Error("The server sent an unexpected response. Please try again.");
  return body as T;
}
