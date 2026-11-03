const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KiB is plenty for <head>
const PREVIEW_TIMEOUT_MS = 5000;

const PRIVATE_IPV4_PATTERNS = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,
];

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))) {
    return true;
  }
  // Bracketed/plain IPv6 loopback and link/unique-local ranges.
  const v6 = host.replace(/^\[/, "").replace(/\]$/, "");
  if (v6 === "::1" || v6 === "::") {
    return true;
  }
  if (/^(fc|fd|fe80)/.test(v6)) {
    return true;
  }
  return false;
}

export interface UrlMetadata {
  url: string;
  title: string | null;
  description: string | null;
  favicon: string | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function matchAttr(html: string, tagRegex: RegExp): string | null {
  const match = tagRegex.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

function extractTitle(html: string): string | null {
  const ogTitle = matchAttr(
    html,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
  );
  if (ogTitle) {
    return ogTitle;
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return titleTag ? decodeEntities(titleTag[1]) : null;
}

function extractDescription(html: string): string | null {
  return (
    matchAttr(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    ) ??
    matchAttr(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    )
  );
}

function extractFavicon(html: string, baseUrl: string): string | null {
  const href = matchAttr(
    html,
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']*)["']/i,
  );
  const resolved = href ?? "/favicon.ico";
  try {
    return new URL(resolved, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Fetches a URL server-side and extracts lightweight preview metadata
 * (title, description, favicon) for display before a bookmark is saved.
 */
export async function fetchUrlMetadata(rawUrl: string): Promise<UrlMetadata> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be previewed");
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("Refusing to preview a private or local address");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Karakeep-LinkPreview/1.0",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch preview (status ${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (received >= MAX_PREVIEW_BYTES) {
        await reader.cancel();
        break;
      }
    }

    const finalUrl = response.url || parsed.toString();
    return {
      url: finalUrl,
      title: extractTitle(html),
      description: extractDescription(html),
      favicon: extractFavicon(html, finalUrl),
    };
  } finally {
    clearTimeout(timeout);
  }
}
