import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostingConfigPath = path.join(repositoryRoot, "firebase.json");
const firebaseProjectPath = path.join(repositoryRoot, ".firebaserc");
const requestedBuildDirectory = process.argv[2];
const expectedSites = ["partswalaflutter", "partswalaind"];
const spaRewriteSources = [
  "/products", "/products/**", "/product", "/product/**", "/legal", "/legal/**",
  "/profile", "/my-enquiries", "/cart", "/checkout", "/login", "/forgot-password",
  "/register", "/signup", "/orders", "/orders/**", "/dashboard", "/sell",
  "/vendor", "/vendor/**", "/admin", "/admin/**",
];
const globalCacheSource = "**";
const immutableAssetSource = "/assets/**/*-????????*.*";
const fingerprintedAssetPattern = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/;

function fail(message) {
  console.error(`Hosting build verification failed: ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Unable to read ${path.relative(repositoryRoot, filePath)}: ${error.message}`);
    return null;
  }
}

const firebaseConfig = readJson(hostingConfigPath);
if (!firebaseConfig) process.exit(1);
if (!requestedBuildDirectory) {
  fail("Pass an explicit build directory; refusing to treat an existing dist directory as a fresh build.");
  console.error("Usage: npm run verify:hosting-build -- <build-directory>");
  process.exit(2);
}

const buildDirectory = path.resolve(requestedBuildDirectory);
const firebaseProjectConfig = readJson(firebaseProjectPath);
if (firebaseProjectConfig?.projects?.default !== "partswalaflutter") {
  fail('.firebaserc must retain "partswalaflutter" as the default project for this release.');
}

const hostingSites = Array.isArray(firebaseConfig.hosting)
  ? firebaseConfig.hosting
  : [firebaseConfig.hosting].filter(Boolean);
const configuredSites = new Map(hostingSites.map((site) => [site.site, site]));

for (const siteId of expectedSites) {
  const site = configuredSites.get(siteId);
  if (!site) {
    fail(`firebase.json does not configure Hosting site "${siteId}".`);
    continue;
  }
  if (site.public !== "dist") {
    fail(`Hosting site "${siteId}" serves "${site.public}", expected the shared "dist" output.`);
  }
  const rewrites = site.rewrites || [];
  for (const source of spaRewriteSources) {
    if (!rewrites.some((rewrite) => rewrite.source === source && rewrite.destination === "/index.html")) {
      fail(`Hosting site "${siteId}" must rewrite "${source}" to /index.html.`);
    }
  }
  const cacheControlRules = (pattern, value) => site.headers
    ?.filter((rule) => rule[pattern] === value)
    .flatMap((rule) => rule.headers || [])
    .filter((header) => header.key.toLowerCase() === "cache-control")
    .map((header) => header.value) || [];
  const globalCache = cacheControlRules("source", globalCacheSource);
  if (!globalCache.some((value) =>
    value.includes("no-cache") &&
    value.includes("max-age=0") &&
    value.includes("must-revalidate"),
  )) {
    fail(`Hosting site "${siteId}" must revalidate all responses by default.`);
  }
  const assetCache = cacheControlRules("source", immutableAssetSource);
  if (!assetCache.some((value) =>
    value.includes("public") &&
    value.includes("max-age=31536000") &&
    value.includes("immutable"),
  )) {
    fail(`Hosting site "${siteId}" must cache fingerprinted assets immutably for one year.`);
  }
  const headers = site.headers || [];
  const globalHeaderIndex = headers.findIndex((rule) => rule.source === globalCacheSource
    && (rule.headers || []).some((header) => header.key.toLowerCase() === "cache-control"));
  const assetHeaderIndex = headers.findIndex((rule) => rule.source === immutableAssetSource
    && (rule.headers || []).some((header) => header.key.toLowerCase() === "cache-control"));
  if (globalHeaderIndex < 0 || assetHeaderIndex <= globalHeaderIndex) {
    fail(`Hosting site "${siteId}" must apply immutable asset caching after the default revalidation rule.`);
  }
  if (site.headers.some((rule) => rule.regex)) {
    fail(`Hosting site "${siteId}" must express cache policies using supported glob sources.`);
  }
}

if (expectedSites.every((siteId) => configuredSites.has(siteId))) {
  const outputs = expectedSites.map((siteId) => configuredSites.get(siteId).public);
  if (new Set(outputs).size !== 1) {
    fail("The intended Hosting sites do not use the same build output.");
  }
}

const indexPath = path.join(buildDirectory, "index.html");
let indexHtml;
try {
  indexHtml = readFileSync(indexPath, "utf8");
} catch (error) {
  fail(`Unable to read ${indexPath}: ${error.message}`);
  process.exit(1);
}

const references = [];
for (const tag of indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  const attribute = tag[0].match(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/i);
  if (!attribute) continue;

  const reference = attribute[2];
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) continue;
  if (!/\.(?:js|css)(?:[?#]|$)/i.test(reference)) continue;
  if (!fingerprintedAssetPattern.test(reference.split(/[?#]/, 1)[0])) {
    fail(`Referenced asset does not have a fingerprinted filename: ${reference}`);
    continue;
  }

  const assetUrl = new URL(reference, "https://hosting-build.invalid");
  const assetPath = path.resolve(buildDirectory, `.${decodeURIComponent(assetUrl.pathname)}`);
  const relativePath = path.relative(buildDirectory, assetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    fail(`Asset reference escapes the build directory: ${reference}`);
    continue;
  }

  try {
    if (!statSync(assetPath).isFile()) {
      fail(`Referenced asset is not a file: ${reference}`);
      continue;
    }
    references.push({ reference, extension: path.extname(assetPath).toLowerCase() });
  } catch {
    fail(`Referenced asset is missing: ${reference}`);
  }
}

for (const extension of [".js", ".css"]) {
  if (!references.some((asset) => asset.extension === extension)) {
    fail(`index.html has no local ${extension} asset reference.`);
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`Hosting config keeps both sites on shared output and excludes /assets/** from SPA fallback: ${expectedSites.join(", ")} -> dist`);
console.log(`Verified ${references.length} local JS/CSS references in ${indexPath}:`);
for (const asset of references) console.log(`  ${asset.reference}`);
