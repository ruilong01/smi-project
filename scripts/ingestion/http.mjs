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

      // Retry-able errors (429, 503, 504, 502)
      if ([429, 502, 503, 504].includes(response.status)) {
        lastError = new Error(`${response.status} ${response.statusText} (retry-able) for ${url}`);
        if (attempt < retries) {
          const backoffMs = requestDelay * Math.pow(2, attempt - 1);
          console.warn(`Attempt ${attempt}/${retries} failed. Retrying in ${backoffMs}ms...`);
          await delayMs(backoffMs);
          continue;
        }
      }

      // Non-retryable errors
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      lastError = error;

      if (error.name === "AbortError") {
        error.message = `Timeout after ${timeout}ms for ${url}`;
      }

      // If this was the last attempt or a non-retryable error, throw
      if (attempt === retries || error.name === "TypeError") {
        throw error;
      }

      if (attempt < retries) {
        const backoffMs = requestDelay * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt}/${retries} failed (${error.message}). Retrying in ${backoffMs}ms...`);
        await delayMs(backoffMs);
      }
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
