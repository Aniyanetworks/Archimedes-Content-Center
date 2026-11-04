// supabase-js decides when to renew a token using this device's clock, so a device running behind
// keeps sending a token the server has already expired. When the server says so, renew and retry once.
type Fetch = typeof fetch;

export function isExpiredJwt(status: number, body: string): boolean {
  return status === 401 && /jwt expired/i.test(body);
}

export function createAuthFetch(baseFetch: Fetch, refresh: () => Promise<string | null>): Fetch {
  // Parallel requests that all hit an expired token share one renewal.
  let renewing: Promise<string | null> | null = null;

  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401) return response;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/')) return response;
    if (!isExpiredJwt(response.status, await response.clone().text())) return response;

    renewing ??= refresh().finally(() => {
      renewing = null;
    });
    const token = await renewing;
    if (!token) return response;

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };
}
