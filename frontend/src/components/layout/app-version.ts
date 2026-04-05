type VersionPayload = {
  version?: unknown;
};

function parseVersionPayload(payload: VersionPayload | null | undefined): string | null {
  if (!payload || typeof payload.version !== "string") {
    return null;
  }
  const normalized = payload.version.trim();
  return normalized.length > 0 ? normalized : null;
}

async function fetchVersionFromUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as VersionPayload | null;
  return parseVersionPayload(payload);
}

export async function fetchRuntimeAppVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== "production";
  const candidates = isDev ? ["/package.json", "/version.json"] : ["/version.json"];

  for (const candidate of candidates) {
    try {
      const version = await fetchVersionFromUrl(candidate, fetchImpl);
      if (version) {
        return version;
      }
    } catch {
      // Ignore candidate failure and continue to the next source.
    }
  }

  return null;
}

