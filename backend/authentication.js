const REVOCATION_CHECKED_PATHS = [
  /^\/api\/(?:admin|checkout|orders|razorpay|phonepe|shiprocket|refunds|enquiries)(?:\/|$)/,
  /^\/api\/phone\/verification$/,
  /^\/api\/vendor\/(?:dashboard|finance|pickup-location|enquiries)(?:\/|$)/,
  /^\/api\/ai\/chat$/,
];

export function shouldCheckTokenRevocation(path) {
  return REVOCATION_CHECKED_PATHS.some((pattern) => pattern.test(String(path || "")));
}

export function verifyFirebaseIdToken(auth, token, path) {
  return auth.verifyIdToken(token, shouldCheckTokenRevocation(path));
}

/** Safe, non-authorizing metadata for diagnosing a rejected Firebase ID token. */
export function firebaseIdTokenDiagnostics(authorization, now = Date.now()) {
  const header = String(authorization || "");
  const scheme = /^Bearer\s/i.test(header) ? "Bearer" : header ? "Other" : "Missing";
  const token = scheme === "Bearer" ? header.replace(/^Bearer\s+/i, "") : "";
  const segments = token.split(".");
  let jwtHeader = null;
  let payload = null;
  if (segments.length === 3) {
    try { jwtHeader = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8")); } catch { /* malformed header */ }
    try { payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")); } catch { /* malformed payload */ }
  }
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  const audience = typeof payload?.aud === "string"
    ? payload.aud
    : Array.isArray(payload?.aud) && payload.aud.every((value) => typeof value === "string")
      ? payload.aud
      : null;
  return {
    authorizationScheme: scheme,
    jwtSegmentCount: token ? segments.length : 0,
    algorithm: typeof jwtHeader?.alg === "string" ? jwtHeader.alg : null,
    keyIdPresent: typeof jwtHeader?.kid === "string" && jwtHeader.kid.length > 0,
    issuer: typeof payload?.iss === "string" ? payload.iss : null,
    audience,
    subjectPresent: typeof payload?.sub === "string" && payload.sub.length > 0,
    expirationPresent: exp !== null,
    expired: exp === null ? null : exp * 1000 <= now,
  };
}
