import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = path.join(repositoryRoot, "scripts", "verifyHostingBuild.js");
const hostingConfigPath = path.join(repositoryRoot, "firebase.json");

function runVerifier(buildDirectory) {
  const args = [verifierPath];
  if (buildDirectory) args.push(buildDirectory);
  return spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function withBuildOutput(run) {
  const buildDirectory = mkdtempSync(path.join(os.tmpdir(), "partswala-hosting-verifier-"));
  try {
    run(buildDirectory);
  } finally {
    rmSync(buildDirectory, { recursive: true, force: true });
  }
}

test("both Hosting sites rewrite only supported SPA routes and separate cache policies", () => {
  const firebaseConfig = JSON.parse(readFileSync(hostingConfigPath, "utf8"));
  const sites = new Map(firebaseConfig.hosting.map((site) => [site.site, site]));
  const spaRewriteSources = [
    "/products", "/products/**", "/product", "/product/**", "/legal", "/legal/**",
    "/profile", "/my-enquiries", "/cart", "/checkout", "/login", "/forgot-password",
    "/register", "/signup", "/orders", "/orders/**", "/dashboard", "/sell",
    "/vendor", "/vendor/**", "/admin", "/admin/**",
  ];

  for (const siteId of ["partswalaflutter", "partswalaind"]) {
    const site = sites.get(siteId);
    assert.ok(site, `missing Hosting site ${siteId}`);
    const rootRewrite = site.rewrites.find((rewrite) =>
      rewrite.regex === "^[/\\\\]$" && rewrite.destination === "/index.html",
    );
    assert.ok(rootRewrite, `${siteId} must rewrite the root path to the SPA entry point`);
    const rootPattern = new RegExp(rootRewrite.regex);
    assert.ok(rootPattern.test("/"), `${siteId} root rewrite must match /`);
    assert.equal(rootPattern.test("/api/health"), false,
      `${siteId} root rewrite must not match API paths`);
    assert.equal(rootPattern.test("/assets/missing.js"), false,
      `${siteId} root rewrite must not match missing assets`);
    for (const source of spaRewriteSources) {
      assert.ok(site.rewrites.some((rewrite) =>
        rewrite.source === source && rewrite.destination === "/index.html",
      ), `${siteId} must rewrite ${source} to the SPA entry point`);
    }
    assert.equal(site.rewrites.some((rewrite) =>
      rewrite.source === "/assets/**" || rewrite.source === "/assets",
    ), false, `${siteId} must not rewrite missing assets`);
    assert.equal(site.rewrites.some((rewrite) =>
      typeof rewrite.source === "string"
      && (rewrite.source === "/api" || rewrite.source.startsWith("/api/")),
    ), false, `${siteId} must not rewrite API paths to the SPA`);

    const cacheControl = (pattern, value) => site.headers
      .filter((rule) => rule[pattern] === value)
      .flatMap((rule) => rule.headers)
      .filter((header) => header.key.toLowerCase() === "cache-control")
      .map((header) => header.value);
    assert.ok(cacheControl("source", "**").some((value) =>
      value.includes("no-cache") && value.includes("max-age=0") && value.includes("must-revalidate"),
    ), `${siteId} must revalidate by default`);
    const hashedAssetPattern = "/assets/**/*-????????*.*";
    assert.ok(cacheControl("source", hashedAssetPattern).some((value) =>
      value.includes("public") && value.includes("max-age=31536000") && value.includes("immutable"),
    ), `${siteId} must cache fingerprinted JS and CSS assets immutably`);
    assert.equal(cacheControl("source", "/assets/**").length, 0,
      `${siteId} must not grant immutable caching to every asset URL`);
    const globalIndex = site.headers.findIndex((rule) => rule.source === "**"
      && rule.headers.some((header) => header.key.toLowerCase() === "cache-control"));
    const assetsIndex = site.headers.findIndex((rule) => rule.source === hashedAssetPattern
      && rule.headers.some((header) => header.key.toLowerCase() === "cache-control"));
    assert.ok(assetsIndex > globalIndex, `${siteId} must override default cache policy for hashed assets`);
    assert.equal(site.headers.some((rule) => rule.regex), false,
      `${siteId} must use Hosting-supported glob rules for headers`);
  }
});

test("Hosting verifier requires an explicit build output directory", () => {
  const result = runVerifier();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Pass an explicit build directory/);
});

test("Hosting verifier confirms every referenced JavaScript and CSS file exists", () => {
  withBuildOutput((buildDirectory) => {
    mkdirSync(path.join(buildDirectory, "assets"));
    writeFileSync(
      path.join(buildDirectory, "index.html"),
      '<script type="module" src="/assets/app-abcdefgh.js"></script><link rel="stylesheet" href="/assets/app-abcdefgh.css">',
    );
    writeFileSync(path.join(buildDirectory, "assets", "app-abcdefgh.js"), "export {};");
    writeFileSync(path.join(buildDirectory, "assets", "app-abcdefgh.css"), "body{}");

    const result = runVerifier(buildDirectory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified 2 local JS\/CSS references/);
  });
});

test("Hosting verifier rejects an incomplete asset set", () => {
  withBuildOutput((buildDirectory) => {
    mkdirSync(path.join(buildDirectory, "assets"));
    writeFileSync(
      path.join(buildDirectory, "index.html"),
      '<script type="module" src="/assets/app-abcdefgh.js"></script><link rel="stylesheet" href="/assets/app-abcdefgh.css">',
    );
    writeFileSync(path.join(buildDirectory, "assets", "app-abcdefgh.js"), "export {};");

    const result = runVerifier(buildDirectory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Referenced asset is missing: \/assets\/app-abcdefgh\.css/);
  });
});

test("Hosting verifier rejects un-fingerprinted JavaScript and CSS references", () => {
  withBuildOutput((buildDirectory) => {
    mkdirSync(path.join(buildDirectory, "assets"));
    writeFileSync(
      path.join(buildDirectory, "index.html"),
      '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
    );

    const result = runVerifier(buildDirectory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not have a fingerprinted filename/);
  });
});
