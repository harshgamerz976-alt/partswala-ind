import { PARTSWALA_LAUNCH_UTC } from "../shared/preLaunch.js";
import { pathToFileURL } from "node:url";

const DEFAULT_API_ORIGIN = "https://partswala-ind.onrender.com";
const FRONTEND_ORIGINS = [
  "https://partswalaind.web.app",
  "https://partswalaind.com",
];
const SPA_ROUTES = [
  "/products",
  "/products/readiness-probe",
  "/product/readiness-probe",
  "/legal/privacy",
  "/vendor/login",
  "/my-enquiries",
];
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 20000;

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function containsProtectedResponseData(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/^(products?|reviews?|whatsappnumber|vendorcontact|vendoremail|vendorphone)$/i.test(key)) {
      return true;
    }
    return containsProtectedResponseData(child);
  });
}

function hasNoStore(response) {
  return /(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get("cache-control") || "");
}

function missingSecurityHeaders(response, isHostingResponse = false) {
  const requiredHeaders = isHostingResponse
    ? [
      ["strict-transport-security", /(?:^|;)\s*max-age=31536000(?:;|$)/i],
      ["x-content-type-options", /^nosniff$/i],
      ["x-frame-options", /^deny$/i],
      ["referrer-policy", /^strict-origin-when-cross-origin$/i],
      ["permissions-policy", /.+/],
      ["content-security-policy-report-only", /(?:^|;)\s*default-src\s+'self'/i],
    ]
    : [
      ["strict-transport-security", /(?:^|;)\s*max-age=31536000(?:;|$)/i],
      ["x-content-type-options", /^nosniff$/i],
      ["x-frame-options", /^deny$/i],
      ["referrer-policy", /^no-referrer$/i],
      ["permissions-policy", /.+/],
      ["content-security-policy", /(?:^|;)\s*default-src\s+'none'/i],
    ];
  return requiredHeaders
    .filter(([name, valuePattern]) => !valuePattern.test(response.headers.get(name) || ""))
    .map(([name]) => name);
}

function hasHtmlContentType(response) {
  return /text\/html/i.test(response.headers.get("content-type") || "");
}

function hasHtmlRevalidation(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return /no-cache/i.test(cacheControl)
    && /max-age\s*=\s*0/i.test(cacheControl)
    && /must-revalidate/i.test(cacheControl);
}

function hasImmutableAssetCache(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return /public/i.test(cacheControl)
    && /max-age\s*=\s*31536000/i.test(cacheControl)
    && /immutable/i.test(cacheControl);
}

async function fetchWithoutLoggingBody(fetchImpl, url) {
  return fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json, text/html, */*" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function fetchFrontendResource(fetchImpl, startUrl, allowedHosts) {
  const visited = new Set();
  let url = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (visited.has(url)) {
      throw new Error("redirect loop");
    }
    visited.add(url);
    const response = await fetchWithoutLoggingBody(fetchImpl, url);
    if (response.status < 300 || response.status >= 400) {
      return { response, redirects };
    }
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) {
      throw new Error("redirect could not be followed");
    }
    const nextUrl = new URL(location, url);
    if (nextUrl.protocol !== "https:" || !allowedHosts.has(nextUrl.host)) {
      throw new Error("redirect left the approved HTTPS domains");
    }
    url = nextUrl.href;
  }
  throw new Error("redirect limit exceeded");
}

function extractAssetReferences(html) {
  const references = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const isScript = /^<script\b/i.test(tag);
    const attributeName = isScript ? "src" : "href";
    const attribute = tag.match(new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    if (!attribute) continue;
    const reference = attribute[2];
    if (!/^\/assets\/[^?#]+\.(?:js|css)$/i.test(reference)) continue;
    if (!/-[a-z\d_-]{8,}\.(?:js|css)$/i.test(reference)) continue;
    references.push(reference);
  }
  return [...new Set(references)];
}

export async function runProductionGetVerification({
  apiOrigin = DEFAULT_API_ORIGIN,
  frontendOrigins = FRONTEND_ORIGINS,
  productId = "",
  fetchImpl = fetch,
  output = (line) => console.log(line),
} = {}) {
  const results = [];
  const record = (label, passed, details = "") => {
    results.push({ label, passed });
    output(`${passed ? "PASS" : "FAIL"} ${label}${details ? ` — ${details}` : ""}`);
  };
  const skip = (label, details) => {
    results.push({ label, passed: true, skipped: true });
    output(`SKIP ${label} — ${details}`);
  };
  const request = async (label, url, expectedStatus, validate) => {
    try {
      const response = await fetchWithoutLoggingBody(fetchImpl, url);
      const text = await response.text();
      const body = parseJson(text);
      const errors = [];
      const { pathname } = new URL(url);
      if (pathname === "/health" || pathname.toLowerCase().startsWith("/api/")) {
        const missingHeaders = missingSecurityHeaders(response);
        if (missingHeaders.length) errors.push(`missing security headers: ${missingHeaders.join(", ")}`);
      }
      if (response.status !== expectedStatus) errors.push(`HTTP ${response.status}`);
      if (response.status >= 300 && response.status < 400) errors.push("unexpected redirect");
      if (validate) errors.push(...validate(response, body, text));
      record(label, errors.length === 0, errors.join(", "));
      return { response, body, text, passed: errors.length === 0 };
    } catch (error) {
      record(label, false, error?.name === "TimeoutError" ? "request timed out" : "request failed");
      return null;
    }
  };

  if (!isHttpsOrigin(apiOrigin)) {
    record("API origin", false, "must be an HTTPS origin without a path");
    return { passed: false, results };
  }
  const apiBase = apiOrigin.replace(/\/+$/, "");
  await request("API health", `${apiBase}/health`, 200);

  await request("public launch settings", `${apiBase}/api/settings/public`, 200, (response, body) => {
    const errors = [];
    if (!hasNoStore(response)) errors.push("missing no-store");
    if (body?.preLaunchEnabled !== true) errors.push("pre-launch gate is not enabled");
    if (Date.parse(body?.launchTime) !== Date.parse(PARTSWALA_LAUNCH_UTC)) errors.push("launch instant mismatch");
    const serverTimeMs = Date.parse(body?.serverTimeUtc);
    const remainingMs = body?.millisecondsUntilLaunch;
    if (!Number.isFinite(serverTimeMs) || !Number.isFinite(remainingMs)) {
      errors.push("authoritative server time is missing");
    } else if (Math.abs((Date.parse(PARTSWALA_LAUNCH_UTC) - serverTimeMs) - remainingMs) > 5000) {
      errors.push("server time and remaining time disagree");
    }
    return errors;
  });

  const idIsValid = typeof productId === "string"
    && productId.length > 0
    && productId.length <= 200
    && productId !== "."
    && productId !== ".."
    && !/[/?#\\]/u.test(productId);
  if (!idIsValid) {
    record("direct-product probe ID", false, "set PARTSWALA_PROBE_PRODUCT_ID to a known document ID; its value is never logged");
  }
  const encodedId = idIsValid ? encodeURIComponent(productId) : "";

  const restrictedGetPaths = [
    ["catalogue list", "/api/public-products?limit=1"],
    ["catalogue list trailing slash/query", "/api/public-products/?limit=1&probe=readiness"],
    ["catalogue case variant", "/API/PUBLIC-PRODUCTS?limit=1"],
    ...(idIsValid ? [
      ["product detail", `/api/public-products/${encodedId}`],
      ["product detail trailing slash/query", `/api/public-products/${encodedId}/?probe=readiness`],
      ["vendor contact", `/api/products/${encodedId}/vendor-contact`],
      ["vendor contact trailing slash/query", `/api/products/${encodedId}/vendor-contact/?probe=readiness`],
      ["product reviews", `/api/reviews?productId=${encodedId}`],
      ["product reviews trailing slash/query", `/api/reviews/?productId=${encodedId}&limit=1`],
    ] : []),
    ["assistant public settings", "/api/settings/assistant/public"],
    ["assistant public settings trailing slash/query", "/api/settings/assistant/public/?probe=readiness"],
  ];

  for (const [label, pathname] of restrictedGetPaths) {
    await request(label, `${apiBase}${pathname}`, 403, (response, body, text) => {
      const errors = [];
      if (!hasNoStore(response)) errors.push("missing no-store");
      if (containsProtectedResponseData(body)) errors.push("protected response fields present");
      if (!body && /"?(?:products?|reviews?|whatsappnumber|vendorcontact)"?\s*:/i.test(text)) {
        errors.push("protected response fields present");
      }
      return errors;
    });
  }

  skip(
    "POST-only catalogue by-ids and vendor-names routes",
    "no production request sent; candidate declares these as POST and mounted-server tests verify the pre-launch 403 gate",
  );
  skip(
    "reviews collection without productId",
    "no production request sent; candidate requires a productId and its GET handler is checked with the supplied probe ID",
  );

  for (const [label, pathname] of [
    ["unauthenticated vendor access", "/api/vendor/access"],
    ["unauthenticated customer enquiries", "/api/enquiries"],
    ["unauthenticated vendor enquiries", "/api/vendor/enquiries"],
    ["unauthenticated vendor dashboard", "/api/vendor/dashboard"],
  ]) {
    await request(label, `${apiBase}${pathname}`, 401, (response, body) => {
      const errors = [];
      if (!hasNoStore(response)) errors.push("missing no-store");
      if (containsProtectedResponseData(body)) errors.push("protected response fields present");
      return errors;
    });
  }

  const allowedHosts = new Set(frontendOrigins.map((origin) => {
    if (!isHttpsOrigin(origin)) return "";
    return new URL(origin).host;
  }).filter(Boolean));
  for (const origin of frontendOrigins) {
    if (!isHttpsOrigin(origin)) {
      record("frontend origin", false, "must be an HTTPS origin without a path");
      continue;
    }
    const siteLabel = new URL(origin).host;
    let root;
    try {
      root = await fetchFrontendResource(fetchImpl, `${origin}/`, allowedHosts);
      const { response, redirects } = root;
      const html = await response.text();
      const missingHeaders = missingSecurityHeaders(response, true);
      const passed = response.status === 200
        && hasHtmlContentType(response)
        && hasHtmlRevalidation(response)
        && missingHeaders.length === 0;
      record(`${siteLabel} HTML root/cache`, passed, [
        `HTTP ${response.status}`,
        `redirects=${redirects}`,
        hasHtmlContentType(response) ? "HTML" : "not HTML",
        hasHtmlRevalidation(response) ? "revalidation cache" : "cache policy mismatch",
        missingHeaders.length ? `missing security headers: ${missingHeaders.join(", ")}` : "security headers OK",
      ].join(", "));

      const assets = extractAssetReferences(html);
      const extensions = new Set(assets.map((asset) => asset.toLowerCase().endsWith(".js") ? "js" : "css"));
      for (const extension of ["js", "css"]) {
        record(`${siteLabel} hashed ${extension} reference`, extensions.has(extension), extensions.has(extension) ? "" : "missing from HTML");
      }
      for (const asset of assets) {
        try {
          const assetResult = await fetchFrontendResource(fetchImpl, new URL(asset, `${origin}/`).href, allowedHosts);
          const { response } = assetResult;
          const contentType = response.headers.get("content-type") || "";
          const correctMime = extensionMimeMatches(asset, contentType);
          const missingAssetHeaders = missingSecurityHeaders(response, true);
          const passedAsset = response.status === 200
            && correctMime
            && hasImmutableAssetCache(response)
            && missingAssetHeaders.length === 0;
          record(`${siteLabel} hashed ${asset.toLowerCase().endsWith(".js") ? "js" : "css"} asset`, passedAsset, [
            `HTTP ${response.status}`,
            correctMime ? "MIME OK" : "MIME mismatch",
            hasImmutableAssetCache(response) ? "immutable cache" : "cache policy mismatch",
            missingAssetHeaders.length ? `missing security headers: ${missingAssetHeaders.join(", ")}` : "security headers OK",
          ].join(", "));
        } catch {
          record(`${siteLabel} hashed asset`, false, "request failed or redirect loop");
        }
      }

      for (const route of SPA_ROUTES) {
        try {
          const routeResult = await fetchFrontendResource(fetchImpl, `${origin}${route}`, allowedHosts);
          const { response } = routeResult;
          const routePassed = response.status === 200
            && hasHtmlContentType(response)
            && hasHtmlRevalidation(response)
            && missingSecurityHeaders(response, true).length === 0;
          const missingRouteHeaders = missingSecurityHeaders(response, true);
          record(`${siteLabel} SPA ${route}`, routePassed, [
            `HTTP ${response.status}`,
            hasHtmlContentType(response) ? "HTML" : "not HTML",
            hasHtmlRevalidation(response) ? "revalidation cache" : "cache policy mismatch",
            missingRouteHeaders.length ? `missing security headers: ${missingRouteHeaders.join(", ")}` : "security headers OK",
          ].join(", "));
        } catch {
          record(`${siteLabel} SPA route`, false, "request failed or redirect loop");
        }
      }

      try {
        const missingPath = `/assets/__partswala_missing_${Date.now()}__.js`;
        const missing = await fetchFrontendResource(fetchImpl, `${origin}${missingPath}`, allowedHosts);
        const missingType = missing.response.headers.get("content-type") || "";
        const missingHeaders = missingSecurityHeaders(missing.response, true);
        record(`${siteLabel} missing asset`, missing.response.status === 404
          && !/text\/html/i.test(missingType)
          && missingHeaders.length === 0, [
          `HTTP ${missing.response.status}`,
          /text\/html/i.test(missingType) ? "received HTML" : "non-HTML response",
          missingHeaders.length ? `missing security headers: ${missingHeaders.join(", ")}` : "security headers OK",
        ].join(", "));
      } catch {
        record(`${siteLabel} missing asset`, false, "request failed or redirect loop");
      }
    } catch {
      record(`${siteLabel} HTML root/cache`, false, "request failed or redirect loop");
    }
  }

  const checkedResults = results.filter(({ skipped }) => !skipped);
  const passedCount = checkedResults.filter(({ passed: checkPassed }) => checkPassed).length;
  const skippedCount = results.length - checkedResults.length;
  const passed = passedCount === checkedResults.length;
  output(`${passed ? "PASS" : "FAIL"} production GET verification: ${passedCount}/${checkedResults.length} checks passed${skippedCount ? `; ${skippedCount} skipped` : ""}`);
  return { passed, results };
}

function extensionMimeMatches(asset, contentType) {
  if (asset.toLowerCase().endsWith(".js")) return /(?:javascript|ecmascript)/i.test(contentType);
  if (asset.toLowerCase().endsWith(".css")) return /text\/css/i.test(contentType);
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runProductionGetVerification({
    apiOrigin: process.env.PARTSWALA_API_ORIGIN || DEFAULT_API_ORIGIN,
    productId: process.env.PARTSWALA_PROBE_PRODUCT_ID || "",
  });
  if (!result.passed) process.exitCode = 1;
}
