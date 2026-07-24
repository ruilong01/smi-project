import { INGESTION_USER_AGENT } from "./config.mjs";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 4;
const DEFAULT_REQUEST_DELAY_MS = 1000;

// Delay utility for throttling requests
export async function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build User-Agent with email for API politeness
export function buildUserAgent(email = null) {
  let ua = INGESTION_USER_AGENT;
  if (email) {
    ua += ` (mailto:${email})`;
  }
  return ua;
}

// Only these are worth retrying - a transient server/rate-limit condition
// that might succeed a moment later. A 401/403/404/etc is a definitive
// answer that will NEVER change on retry - hammering it 3-4 times just
// wastes time and looks like abusive traffic to the remote server.
export const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

// Retry logic with exponential backoff
async function fetchWithRetry(
  url,
  options = {},
  { retries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT_MS, requestDelay = DEFAULT_REQUEST_DELAY_MS } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success cases
      if (response.ok) {
        return response;
      }

      if (!RETRYABLE_STATUSES.includes(response.status)) {
        // A definitive error response - fail immediately, never retry.
        throw Object.assign(new Error(`${response.status} ${response.statusText} for ${url}`), {
          nonRetryable: true,
          status: response.status,
        });
      }

      lastError = new Error(`${response.status} ${response.statusText} (retry-able) for ${url}`);
      if (attempt === retries) {
        throw lastError;
      }
      const backoffMs = requestDelay * Math.pow(2, attempt - 1);
      console.warn(`Attempt ${attempt}/${retries} failed (${response.status}, retryable). Retrying in ${backoffMs}ms...`);
      await delayMs(backoffMs);
    } catch (error) {
      if (error.nonRetryable) {
        throw error;
      }

      lastError = error;

      if (error.name === "AbortError") {
        error.message = `Timeout after ${timeout}ms for ${url}`;
      }

      // If this was the last attempt or a non-retryable error, throw
      if (attempt === retries || error.name === "TypeError") {
        throw error;
      }

      const backoffMs = requestDelay * Math.pow(2, attempt - 1);
      console.warn(`Attempt ${attempt}/${retries} failed (${error.message}). Retrying in ${backoffMs}ms...`);
      await delayMs(backoffMs);
    }
  }

  throw lastError || new Error(`Failed after ${retries} retries for ${url}`);
}

export async function fetchJson(url, options = {}) {
  const { email = null, retries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT_MS, requestDelay = DEFAULT_REQUEST_DELAY_MS } =
    options.fetchOptions ?? {};

  const response = await fetchWithRetry(
    url,
    {
      ...options,
      headers: {
        "User-Agent": buildUserAgent(email),
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    },
    { retries, timeout, requestDelay }
  );

  return response.json();
}

// Returns the raw Response (not parsed as JSON/text) - for callers that
// need to inspect headers (e.g. content-type before trusting a body is
// really a PDF) or read a binary body (arrayBuffer), which fetchJson/
// fetchText can't provide.
export async function fetchRaw(url, options = {}) {
  const { email = null, retries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT_MS, requestDelay = DEFAULT_REQUEST_DELAY_MS } =
    options.fetchOptions ?? {};

  return fetchWithRetry(
    url,
    {
      ...options,
      headers: {
        "User-Agent": buildUserAgent(email),
        ...(options.headers ?? {}),
      },
    },
    { retries, timeout, requestDelay }
  );
}

export async function fetchText(url, options = {}) {
  const { email = null, retries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT_MS, requestDelay = DEFAULT_REQUEST_DELAY_MS } =
    options.fetchOptions ?? {};

  const response = await fetchWithRetry(
    url,
    {
      ...options,
      headers: {
        "User-Agent": buildUserAgent(email),
        Accept: "text/html,application/xhtml+xml",
        ...(options.headers ?? {}),
      },
    },
    { retries, timeout, requestDelay }
  );

  return response.text();
}
