// Per-host request pacing. Distinct from http.mjs's retry backoff (which
// only delays between retries of the SAME request) — this tracks the last
// request time per hostname across DIFFERENT requests, so hitting the same
// publisher (e.g. sciencedirect.com) for several candidates in a row waits
// a minimum gap instead of firing back-to-back, which is more likely to
// read as automated traffic to anti-bot systems.

const lastRequestAtByHost = new Map();

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function waitForHostSlot(url, minGapMs = 6000) {
  const host = getHostname(url);
  const lastAt = lastRequestAtByHost.get(host);
  const now = Date.now();

  if (lastAt !== undefined) {
    const elapsed = now - lastAt;
    if (elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  lastRequestAtByHost.set(host, Date.now());
}
