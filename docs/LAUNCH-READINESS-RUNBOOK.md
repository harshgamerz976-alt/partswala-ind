# PartsWalaIND launch readiness and release runbook

## Latest verified local state — 2026-11-06

- **Production remains NO-GO.** No deployment or post-fix production verification was performed for this update. Earlier read-only production findings below remain blockers; local tests do not establish that production is fixed.
- Invalid server-clock timestamps now fail closed for protected API routes, including the admin exception. Public settings reject invalid/out-of-range dates with HTTP 503 and `Cache-Control: no-store`; valid settings retain the fixed launch instant, `2026-11-08 00:00 IST` (`2026-11-07T18:30:00.000Z`).
- Latest isolated-candidate validation: full backend suite with Auth and Firestore emulators **301 passed, 0 failed, 0 skipped**; backend pricing/shipping tests **57 passed, 0 failed, 0 skipped**; focused launch/policy/settings suite **24 passed, 0 failed** (previously recorded); frontend Node tests **35 passed, 0 failed, 0 skipped**; `npm run lint` passed with generated build/emulator output excluded; Hosting build verification passed; Hosting Emulator routing **1 passed, 0 failed, 0 skipped** against the latest build. The fresh production build succeeded with the existing large-chunk warning. The full backend suite was not rerun after the frontend-only submission-form and shipping-stub cleanups.
- No countdown has been implemented. The launch page uses a static launch date; status refresh uses a fixed 30-second poll and does not calculate or display a countdown.
- Current checkout: branch `release/partswala-launch-20261021`, HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce`, **56 modified tracked paths and 65 untracked files (121 paths total), 0 staged paths, 0 tracked deletions**. Compared with the saved 117-path manifest, the four additions are the Firestore access-matrix emulator test, vendor-submission helper/test, and shipping-service stub cleanup. All 121 paths were verified present and byte-identical in the isolated validation copy. The candidate is not an immutable deployable revision.
- No production deployment, production verification after this local fix, Firestore rules publication, DNS change, or production write occurred. Protected `dist/` and Firestore debug logs remain untouched.
- **Firestore rules coverage:** the expanded emulator matrix now exercises document authorization and collection-list/query behavior for products, categories, settings, coupons, and campaigns across anonymous, customer, vendor, pending-vendor, and admin roles; cross-vendor product queries and filtered unauthorized queries are included. The matrix and full Auth/Firestore emulator suite passed. Residual test coverage is not exhaustive for collection-list/query behavior on user profiles, device tokens, vendor applications, presence, product-cost/order-finance records, and some administrative collections. This is a review/coverage gap, not a confirmed rules defect. Keep publication blocked until the owner reviews the candidate rules and the remaining coverage scope.

## Current release blockers

- **Historical production probes — 2026-11-01:** Render `/health` returned 200. `/api/settings/public` returned 200 with `Cache-Control: no-store` but only the older `preLaunchEnabled` and `comingSoonVideoUrl` fields. Anonymous catalogue list and detail requests returned 200 before launch without `Cache-Control`; `/api/reviews` also returned 200 without `Cache-Control`. This confirmed pre-launch catalogue exposure at that time. The old settings shape and missing response headers are consistent with older backend code, but do not identify the actual Render service, source branch, or deployed SHA.
- **Historical Hosting probes — 2026-11-01:** `partswalaind.com` and `partswalaind.web.app` returned different HTML bundle references and `Cache-Control: max-age=3600`. A `.com` JavaScript asset request and product deep link returned 301 self-redirects. On `.web.app`, an existing Login lazy chunk returned JavaScript, but a missing `/assets/*.js` path returned 200 HTML with `max-age=3600`; a product deep link returned HTML with the same cache lifetime. These live results did not match the candidate's local Hosting configuration. They do not prove which Hosting site owns the custom domain or explain the `.com` redirect.
- **Local release-path finding:** the candidate's launch protections exist only in the dirty working tree; HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce` does not contain them. No Render manifest or deploy script is present, and the Render dashboard/service metadata is unavailable. The exact deployed service/source cannot be inferred. Render must deploy an owner-reviewed immutable repository snapshot that includes the backend gate changes and their runtime dependencies; do not deploy the current mutable checkout.
- Read-only production checks on 2026-10-30 reconfirmed blockers: Render `/health` returned 200; `/api/settings/public` returned 200 with `preLaunchEnabled: true` but omitted `launchTime`, `serverTimeUtc`, and `millisecondsUntilLaunch`; `/api/public-products?limit=1` returned 200 without a `Cache-Control` response header; and `/api/reviews?productId=launch-gate-audit-probe` returned 200 before launch. No response product records were printed. These checks are evidence of the current responses observed at that time, not evidence about any later deployment.
- The local candidate's catalogue cache protection is implemented and tested: all `/api/public-products` responses set `Cache-Control: no-store`, and frontend catalogue fetches use `cache: "no-store"`. This is **not deployed/verified in production**. The production catalogue HTTP 200 remains a launch blocker even if cached data is not printed.
- Raw Firestore product reads are now restricted locally to authorized admins and approved vendors reading documents whose `sellerId` matches their UID. Anonymous/customer raw reads remain denied regardless of launch time; public catalogue reads must use the launch-gated, sanitized backend API. The emulator verified current denial/admin/vendor ownership behavior; post-launch time cannot be simulated in the configured emulator, but this revised raw-read rule has no time-based public grant. These rules have **not** been published or verified as the deployed rules.
- The production detail probe `/api/public-products/launch-gate-audit-probe` and vendor-contact probe returned 404; this does not prove that those deployed routes enforce the launch gate. Treat both as **NOT VERIFIED**. The public reviews probe returned 200 and is a confirmed pre-launch production blocker.
- The 2026-10-30 audit observed the app-wide Coming Soon return hiding vendor login and vendor pages. The local candidate now has a narrow pre-launch exception for vendor sign-in and server-verified approved vendors on dashboard, import, enquiry, and own-profile routes; server approval checks remain authoritative. The deployed frontend behavior has not been reverified.
- `.firebaserc` selects project `partswalaflutter` by default. `firebase.json` configures Hosting sites `partswalaflutter` and `partswalaind`, both from `dist`. The actual association for `partswalaind.com` is not present in repository configuration and remains **NOT VERIFIED**; confirm it in Firebase Console before selecting a Hosting target.
- The worktree has local modifications and untracked files. Its current HEAD is `c7e889f87860b261d99aeb3e556829d71acc90ce`, branch `release/partswala-launch-20261021`; that commit predates these working-tree changes and is **not** a deployable representation of this candidate. The inspected `origin` is `https://github.com/harshgamerz976-alt/partswala-ind.git`; this does not establish Render's configured repository or deployable commit.
- No Render service configuration file identifies the production service ID/name, configured branch, root directory, build/start commands, health-check path, or auto-deploy policy. These and the deployable commit are **unresolved**. Confirm them in the Render dashboard and release process; do not infer them from the hostname or Git remote.
- Firebase CLI read-only metadata confirms project `partswalaflutter` has Hosting sites `partswalaflutter` and `partswalaind`, and a default Firestore database. `firebase.json` targets `firestore.rules` and configures local Auth/Firestore emulators on loopback ports 9099/8080. CLI site listing does not reveal the custom-domain mapping. No Render service configuration was found; service/repository/branch/root/build/start/health-check/deployed commit must be confirmed in Render Dashboard.

- No staging environment was identified. Production is not a substitute for staging.

## Release candidate package and deployment sequence

The candidate is a dirty working tree, not an immutable release artifact. The earlier 2026-11-06 pre-documentation snapshot contained 55 modified tracked paths plus 62 untracked files (**117 candidate paths total**), 0 staged paths, and no tracked deletions. The current 121-path status above supersedes that snapshot; the four later additions are the Firestore access-matrix emulator test, vendor-submission helper/test, and shipping-service stub cleanup. Earlier inventory counts in the historical validation notes below are snapshots, not current totals. Preserve all existing work and ignored `dist/` and Firestore debug logs; do not deploy directly from a mutable checkout. The complete file-by-file inventory and classification are in [NOV-6-PRODUCTION-HANDOFF.md](./NOV-6-PRODUCTION-HANDOFF.md).

### Repository-backed deployment configuration

- **Render:** there is no Render manifest or deploy script. The backend has its own `backend/package.json` and lockfile, with no build script, `start: node server.js`, and `test: node --test`. Backend code imports sibling `src/` and `shared/` modules, so the repo-backed release configuration to confirm in Render is repository root (blank/`.`), build command `npm ci --prefix backend`, start command `npm --prefix backend start`, health-check path `/health`, and Node 22 or newer. Do **not** configure `backend` as an isolated root unless the Render owner verifies that the deployed source still includes the sibling modules. These values are derived from repository files, **not verified production settings**. The Render owner must first identify the service, repository, branch, root, current deployed SHA, and environment-variable presence; never expose variable values. The immutable source snapshot must include `backend/server.js`, `backend/publicProductCatalogRoutes.js`, `backend/publicSettings.js`, `backend/marketplaceLaunch.js`, `shared/preLaunch.js`, and all other runtime imports from the reviewed candidate. The current uncommitted working tree cannot be selected as a deployable commit.
- **Firebase Hosting:** `firebase.json` has two independent site entries, `partswalaflutter` and `partswalaind`. Both use the same `dist` output, exclude `/assets/**` from the SPA fallback, revalidate non-assets, and assign immutable caching to fingerprinted `/assets/**`. Local verifier and Hosting Emulator tests cover the config and missing-chunk 404. Firebase releases each site independently: a shared local output does not synchronize their active releases. Build one reviewed frontend artifact from the exact approved release commit; do not build different source for either site. The custom-domain mapping is still unverified. Confirm Firebase Console → project `partswalaflutter` → Hosting → each site → Custom domains, including the `.com` attachment and SSL status, before selecting targets. If both are confirmed active for this app, deploy the same reviewed build separately and verify both asset manifests match. The `.com` self-redirect is not caused by a redirect in the local `firebase.json`; domain attachment, CDN, or active release requires Firebase owner investigation.
- **Frontend API:** production safely falls back to `https://partswala-ind.onrender.com`; build-time overrides `VITE_API_URL` / `VITE_BACKEND_API_URL` and `VITE_AI_API_URL` must be checked for the approved backend and must not point at localhost or a different service. The browser Firebase config is currently embedded in `src/firebase.js`; Firebase owner must confirm intended project `partswalaflutter` and authorized domains. The detected Firebase web API key is public client configuration, not a server credential; verify API restrictions in Firebase/Google settings without copying the value into release records.
- **CORS:** if Render sets `ALLOWED_ORIGINS`, it replaces the code defaults. Confirm it includes only the approved active domains, including the exact Firebase `*.web.app` host(s) and `https://partswalaind.com`. Do not assume the default list is used in production.
- **Backend environment names:** required by the backend Firebase Admin initialization: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Operational settings to confirm: `PORT` (Render-provided), `FRONTEND_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`. For approved uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; `CLOUDINARY_UPLOAD_PRESET` is optional. Optional assistant providers: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`. Verify presence only; never export values. Do not add checkout/payment/shipping credentials as part of this release; commerce remains disabled.
- **Rules:** `firebase.json` points at local `firestore.rules`, but Firestore rules are a separate security deployment. None of the Hosting commands below deploys rules. Do not publish rules without a separate explicit authorization.

### Ordered release checklist — backend, then frontend

1. Release owner reviews the full inventory in the handoff, confirms no unapproved diff, and creates/approves an immutable release commit through the authorized source-control process. This work session has not staged or committed anything. Freeze that exact SHA for both services.
2. Before deploying, complete all local checks from that immutable checkout:

   ```powershell
   npm ci
   npm ci --prefix backend
   npm run lint
   firebase emulators:exec --config firebase.json --project demo-partswalaind --only auth,firestore "npm --prefix backend test"
   $tests = @(Get-ChildItem -LiteralPath 'src' -Recurse -File | Where-Object { $_.Name -match '\.test\.' } | ForEach-Object { $_.FullName })
   if ($tests.Count -eq 0) { throw 'No frontend tests were discovered.' }
   node --test --test-concurrency=1 $tests
   node --test --test-concurrency=1 scripts/verifyHostingBuild.test.js scripts/verifyProductionGet.test.js
   $buildDir = Join-Path $env:TEMP ('partswala-hosting-' + [guid]::NewGuid().ToString('N'))
   npm run build -- --outDir $buildDir
   if ($LASTEXITCODE -ne 0) { throw 'Temporary Hosting build failed; stop.' }
   npm run verify:hosting-build -- $buildDir
   # Use a temporary, one-site Hosting Emulator config whose public path is $buildDir.
   $env:HOSTING_BUILD_DIR = $buildDir
   firebase emulators:exec --config $hostingConfig --project demo-partswala-hosting --only hosting "node --test --test-concurrency=1 scripts/hostingRouting.emulator.test.js"
   git diff --check
   ```

   The frontend test discovery includes service, component, and page tests. The Hosting build and routing checks use a fresh temporary output directory and temporary emulator configuration; do not write into the protected repository `dist/`. The isolated Auth/Firestore command, frontend tests, Hosting verifier tests, and Hosting Emulator routing test must each pass on the release revision. A prior passing result is not a substitute for rerunning them on that revision.

3. Render owner confirms the live service settings against the repo-backed values above. Deploy the approved backend SHA first using Render’s configured service procedure. Do not change service/environment settings as part of deployment without separate approval.
4. Run the backend post-deployment checks below. Stop if health, gate, authorization, cache, or CORS expectations fail; do not proceed to Hosting.
5. After backend passes, build the same SHA for Hosting (`npm ci; npm run build`) with verified API URL configuration. Deploy `dist` only to owner-confirmed Hosting site IDs using these separate, explicit commands:

   ```powershell
   firebase deploy --only hosting:partswalaind --project partswalaflutter
   firebase deploy --only hosting:partswalaflutter --project partswalaflutter
   ```

   Run each command only for a site the Firebase owner confirms is active for this application. These commands do not deploy Firestore rules. Do not infer the custom-domain mapping from the site IDs.
6. Run the frontend/domain checks and credentialed journeys below; record SHA, Render deploy ID, Hosting release ID, operator and UTC time. If either domain is not intended to serve this app, stop and get a Firebase owner decision rather than deploying to it.

### Post-deployment verification — read-only unless explicitly approved

Set `$api = 'https://partswala-ind.onrender.com'`. Suppress bodies for catalogue and reviews requests. Before 2026-11-08 00:00 IST, expected checks:

| Check | Request / procedure | Expected result |
|---|---|---|
| Health | `GET $api/health` | 200 and service health only. |
| Authoritative launch status | `GET $api/api/settings/public` | 200, `Cache-Control: no-store`; `launchTime` is `2026-11-07T18:30:00.000Z`; `serverTimeUtc` is valid; `millisecondsUntilLaunch` and `preLaunchEnabled` agree with server time. Do not treat missing fields as success. |
| Catalogue list | `GET $api/api/public-products?limit=1` | 403, no product body printed, `Cache-Control: no-store`. |
| Direct product | `GET $api/api/public-products/<known-test-id>` | 403 before ID lookup; no data; no-store. Use only a synthetic/non-sensitive ID. |
| Catalogue by IDs | `POST $api/api/public-products/by-ids` with `{"productIds":["synthetic-launch-probe"]}` | 403, no data, no-store. |
| Reviews | `GET $api/api/reviews?productId=synthetic-launch-probe` | 403, no review data, no-store. |
| Customer's existing enquiry list | `GET $api/api/enquiries` without credentials: 401. With a customer test token before launch: 403/no-store; at/after launch: 200 containing only that buyer's own records. | The candidate specifically gates customer-profile reads before launch. |
| Approved vendor enquiry list/quote | `GET $api/api/vendor/enquiries` and `PATCH $api/api/vendor/enquiries/<owned-test-enquiry-id>/quote` with approved vendor test token | Vendor-owned list stays available pre-launch; owner quote may succeed on a staged/isolated test enquiry. Other vendors/customers/admins remain denied. Do not create a production customer enquiry before launch. |
| Anonymous vendor approval | `GET $api/api/vendor/access` | 401 and no-store. |
| Credentialed vendor approval | With a test-only Firebase ID token kept out of shell history/logs: `GET $api/api/vendor/access` | Approved test vendor: 200 and `{"approvedVendor":true}`. Pending, rejected, suspended, customer, and admin accounts: 403. Vendor dashboard/enquiry/import routes must remain owner-scoped; no foreign product/job access. |
| Admin journey | Browser `/admin/login`; then test-only authorized admin dashboard/API | Login and data loading succeed only for existing verified admin authorization; ordinary accounts are denied. Do not use a production customer/admin account as a fixture. |
| Approved vendor browser route | Browser `/vendor/login`, sign in with approved test vendor, then `/vendor`, `/vendor/enquiries`, `/vendor/import`, `/profile` | Login is available before launch; approved vendor reaches only permitted vendor surfaces. Pending/rejected/suspended accounts cannot access these routes or APIs. |
| Allowed CORS | OPTIONS `$api/api/public-products` with Origin equal to each owner-approved Hosting origin and `Access-Control-Request-Method: GET` | 204 with that exact allowed origin; no wildcard. |
| Denied CORS | Same OPTIONS request with `Origin: https://unapproved-origin.example` | 403 and no `Access-Control-Allow-Origin`; never a success-shaped response. |
| Upload validation | Approved vendor: multipart POST `$api/api/vendor/product-images` with field `file` and optional `productId`; profile/general/return/admin-product uploads use multipart `$api/api/uploads/cloudinary` with `file` and `purpose` | Vendor product path enforces 5 MiB plus filename/MIME/signature and owner checks; general path enforces 8 MiB plus filename/MIME/signature and purpose authorization; invalid/oversized files never reach Cloudinary; the old signature endpoint returns 410. Test only with synthetic fixtures and an isolated Cloudinary account. |
| Enquiry and quote | Test/staging: buyer `POST /api/vendor/enquiries`, buyer `GET /api/enquiries`, owner vendor `GET /api/vendor/enquiries`, vendor `PATCH /api/vendor/enquiries/<id>/quote`, buyer rereads | Creation 201, only owning vendor sees it, quote 200, only buyer sees response; notifications target only authorized recipients. In production before launch, customer enquiry creation is intentionally gated. Any production test write requires separate written approval and isolated test identities/data. |
| Commerce | Requests to checkout/order/payment/shipping endpoints before and after launch | Remain unavailable; this release must not enable checkout, order creation, online payment, or shipping. |
| Frontend parity | GET both `https://partswalaind.web.app/` and `https://partswalaind.com/`; inspect bundle asset names; open direct `/vendor/login` and customer/product routes | Only owner-confirmed production domains are tested. Active domains must serve the same approved asset manifest; vendor login is visible pre-launch; customer/product pages remain Coming Soon. Authenticated browser tests use test identities only. |

Do not run write tests against production enquiries, quotes, notifications, uploads, or products without explicit operator approval and isolated test data. Current no-credential live checks are not a substitute for these post-deployment results.

The following PowerShell checks are read-only and intentionally suppress catalogue/review response bodies:

```powershell
$api = 'https://partswala-ind.onrender.com'
$launch = [DateTimeOffset]::Parse('2026-11-07T18:30:00.000Z').ToUnixTimeMilliseconds()
$settings = Invoke-RestMethod "$api/api/settings/public"
$serverNow = [DateTimeOffset]::Parse($settings.serverTimeUtc).ToUnixTimeMilliseconds()
if ($settings.launchTime -ne '2026-11-07T18:30:00.000Z' -or
    $settings.millisecondsUntilLaunch -ne [Math]::Max(0, $launch - $serverNow) -or
    $settings.preLaunchEnabled -ne ($serverNow -lt $launch)) {
  throw 'Public launch settings do not match the fixed server launch instant.'
}

$probeRequests = @(
  @{ Method = 'GET'; Path = '/api/public-products?limit=1' },
  @{ Method = 'GET'; Path = '/api/public-products/synthetic-launch-probe' },
  @{ Method = 'POST'; Path = '/api/public-products/by-ids'; Body = '{"productIds":["synthetic-launch-probe"]}' },
  @{ Method = 'GET'; Path = '/api/reviews?productId=synthetic-launch-probe' }
)
foreach ($probe in $probeRequests) {
  $args = @{ Uri = "$api$($probe.Path)"; Method = $probe.Method; SkipHttpErrorCheck = $true }
  if ($probe.Body) { $args.ContentType = 'application/json'; $args.Body = $probe.Body }
  $response = Invoke-WebRequest @args
  if ([int]$response.StatusCode -ne 403 -or $response.Headers['Cache-Control'] -notmatch 'no-store') {
    throw "Expected a no-store 403 for $($probe.Method) $($probe.Path)."
  }
}

foreach ($origin in @('https://partswalaflutter.web.app', 'https://partswalaind.web.app', 'https://partswalaind.com')) {
  $response = Invoke-WebRequest "$api/api/public-products" -Method Options -SkipHttpErrorCheck -Headers @{
    Origin = $origin
    'Access-Control-Request-Method' = 'GET'
  }
  if ([int]$response.StatusCode -ne 204 -or $response.Headers['Access-Control-Allow-Origin'] -ne $origin) {
    throw "Expected approved CORS preflight for $origin."
  }
}
$blockedOrigin = Invoke-WebRequest "$api/api/public-products" -Method Options -SkipHttpErrorCheck -Headers @{
  Origin = 'https://unapproved-origin.example'
  'Access-Control-Request-Method' = 'GET'
}
if ([int]$blockedOrigin.StatusCode -ne 403 -or $blockedOrigin.Headers['Access-Control-Allow-Origin']) {
  throw 'Unapproved CORS origin was not explicitly denied.'
}
```

Run the CORS allowlist loop only for domains the Firebase owner confirms active; if Render `ALLOWED_ORIGINS` is configured, adjust the test list to its approved exact origins. Authenticated checks require separately provisioned test identities. Never put real bearer tokens in command history, logs, or this runbook.

### Rollback sequence

- **Hosting:** Firebase CLI in this environment does not expose a `hosting:rollback` command in its help. Use Firebase Console → Hosting → confirmed site → release history to restore that site's last approved release. Roll each confirmed site independently, verify both domains/assets and direct routes, and note that an old Coming Soon build can remove vendor access. Do not change DNS.
- **Render:** use the confirmed Render service's Events/Deploys history to restore a previously validated backend deployment. The currently observed prior backend is known to have pre-launch catalogue/reviews exposure and lacks `/api/vendor/access`; **do not roll back to it as a routine recovery**. If no prior secure release exists, stop rollout and have the owner deploy a reviewed corrective backend or take the service into an owner-approved fail-closed maintenance state. Verify gate/CORS/vendor contracts after any recovery.
- **Coordinated rollback:** frontend rollback does not fix a backend gate bypass. Prefer backend recovery first; keep customer access closed until the gate is verified. Record artifacts and release IDs before rollback. Firestore rules rollback is separate and requires explicit rules-owner approval.

## Read-only production verification — 2026-10-31

The following live checks were performed without credentials, writes, deployment, or rule publication. Product/catalogue response bodies were not printed.

| Target | Observed result | Assessment |
|---|---|---|
| `GET https://partswala-ind.onrender.com/health` | HTTP 200 on retry; an initial request timed out after 30 seconds. | Health endpoint responds, but cold-start/network latency requires monitoring. |
| `GET /api/settings/public` on the Render backend | HTTP 200 and `Cache-Control: no-store`; `preLaunchEnabled: true`, but launch time, server time, and remaining milliseconds were null/missing. | FAIL — candidate rejects this malformed settings response and stays closed; backend deployment/configuration is stale or incomplete. |
| `GET /api/public-products?limit=1` on the Render backend | HTTP 200 before launch; no `Cache-Control` header. Response body omitted. | FAIL — direct public catalogue API access bypasses the intended launch gate in production. |
| `GET /api/reviews?productId=launch-gate-readonly-probe` on the Render backend | HTTP 200 before launch; no `Cache-Control` header. | FAIL — production reviews route is not enforcing the gate. |
| CORS preflight from `https://partswalaind.com` to the catalogue API | HTTP 204; allowed origin was the requesting domain; methods and Authorization/Content-Type headers were allowed. Settings GET also returned the expected CORS origin for both Hosting origins. | PASS for these sampled CORS origins only. |
| CORS preflight from `https://unapproved-origin.example` | HTTP 500 and no `Access-Control-Allow-Origin` header. | No browser CORS access is granted, but the response is an operational 500 rather than an explicit denial. Fix/verify this in the reviewed backend. |
| Unauthenticated vendor/admin GET routes | Vendor dashboard, vendor enquiries, buyer enquiries, vendor import template, admin pending products, and admin pickup locations returned HTTP 401. `/api/vendor/access` returned 404. | Authentication is enforced on sampled protected routes, but vendor approval contract is unavailable in production. Approved-vendor access is not verified. |
| `https://partswalaind.web.app/` and `https://partswalaind.com/` | Both returned HTTP 200 over HTTPS with the PartsWalaIND title and SPA fallback. Their JavaScript/CSS bundle paths differ. The custom domain rendered the older Coming Soon page with only an admin link; direct `/vendor/login` rendered the same Coming Soon page. | FAIL/BLOCKED — domains are serving different builds; approved-vendor pre-launch access is absent on the custom domain. Hosting custom-domain-to-site association remains unconfirmed. |
| HTTP requests to `http://partswalaind.web.app/` and `http://partswalaind.com/` | Both redirected to their HTTPS URLs and completed with HTTP 200. | PASS for HTTP-to-HTTPS redirects. |
| Firebase CLI metadata | Project `partswalaflutter` lists Hosting sites `partswalaflutter` and `partswalaind`; default Firestore database exists. `firestore:releases:list` is not a supported command in the installed CLI. | Deployed rules version could not be compared read-only. No rules were published. |

These observations supersede any interpretation that the older 2026-10-30 observations describe current production. Production is **NOT READY** until the backend gate/settings/cache failures and Hosting bundle mismatch are corrected and reverified.

### Final local validation — 2026-10-31

| Command | Result |
|---|---|
| `firebase emulators:exec --config <temporary-config> --project demo-partswala-launch --only auth,firestore "npm --prefix <repo>\backend test"` | PASS — latest full backend Auth/Firestore emulator suite: 256 passed, 0 failed, 0 skipped. It includes the customer enquiry-list pre-launch denial and the approved-vendor pre-launch exception. The temporary config and copied rules were outside the repository. |
| Focused Auth/Firestore emulator suite: `vendorEnquiries.emulator.test.js`, `firestoreLaunchGate.emulator.test.js`, `vendorBulkImport.emulator.test.js` | PASS — 23 tests passed, 0 failed, 0 skipped after the buyer-list gate change. |
| `npm --prefix backend test` without emulator process | PASS — 236 tests total, 233 passed, 0 failed, 3 emulator-dependent tests skipped as expected. |
| Mismatch subset: `node --test backend/cors.test.js backend/publicSettings.test.js backend/publicProductCatalogRoutes.test.js backend/preLaunch.test.js src/services/vendorAccessService.test.js` | PASS — 31 tests passed, 0 failed, 0 skipped after the buyer-list gate change. |
| `node --test <all src/services/**/*.test.js files>` | PASS — 16 tests passed, 0 failed, 0 skipped. A WebSocket port-in-use notice appeared from the test tooling; test results were successful. |
| Focused launch, commerce, notification, and vendor-image suite | PASS — 31 tests passed, 0 failed, 0 skipped. |
| `node --test backend/cors.test.js` | PASS — 1 test confirms disallowed origins receive HTTP 403 without CORS access and the approved custom domain still receives HTTP 204 preflight. |
| `npm run lint` | PASS — clean. |
| Latest `npm run build -- --outDir <temporary-directory>` | PASS — Vite transformed 174 modules and built in 4.30 seconds. Existing >500 kB chunk-size advisory remains; external output also produced Vite's expected notice that the directory is not emptied. Temporary output was removed after the build. |
| `git diff --check` | PASS — no whitespace errors; existing LF/CRLF normalization notices remain. |

The isolated emulator suite left the existing ignored `firestore-debug.log` length and modification time unchanged. At the end of that earlier validation checkpoint, the worktree had 45 modified tracked paths, 28 untracked files, and 0 staged; branch and HEAD remained the expected values above. These results validate local code only and do not resolve production blockers.

The first isolated run after tightening the customer enquiry-list gate failed the old expectation that an authenticated buyer could read the list pre-launch (one assertion, reported as both the nested test and parent failure). The regression was corrected to expect 403 before launch and 200 at the exact launch instant; approved vendor list and quote access remains available. The final focused and full emulator runs passed.

## Local audit checkpoint

### Verified workspace

- Branch: `release/partswala-launch-20261021`.
- HEAD: `c7e889f87860b261d99aeb3e556829d71acc90ce` (matches the expected base).
- Origin: `https://github.com/harshgamerz976-alt/partswala-ind.git`.
- At the start of this review: 29 modified tracked files, 17 untracked files, and no staged files. This includes pre-existing work; it was preserved. Recheck before any handoff or release.
- Firebase local configuration names project `partswalaflutter` as default and lists Hosting sites `partswalaflutter` and `partswalaind`; both Hosting definitions use `dist`. This does not prove which site is bound to the custom domain.
- No Render configuration file was found in the repository. Dashboard deployment metadata remains unavailable.

### Launch-gate evidence

| Area | Result | Evidence and limitation |
|---|---|---|
| Server authority and exact timestamp | PASS (local code/tests) | Backend uses its server clock (`Date.now()` outside tests), the fixed target `2026-11-07T18:30:00.000Z`, and a fail-closed invalid-clock path. |
| Public settings schema | PASS (local tests) | Tests cover missing store settings, Firestore errors, invalid server time, and consistent `preLaunchEnabled`, `launchTime`, `serverTimeUtc`, and `millisecondsUntilLaunch`; response is `no-store`. |
| Public catalogue and protected API routes | PASS (local tests) | Tests cover catalogue list/detail/by-ID, vendor contact/name lookup, reviews, AI, enquiry creation, checkout/orders, and PhonePe/Razorpay initiation/verification before launch. Backend boundary tests cover before/at/after for relevant routes. |
| Denied write side effects | PASS (demo emulator only) | Emulator tests verify denied enquiry/order requests leave no matching records and protected routes return 403. No production mutation probe was run. |
| Automatic frontend transition | PASS (unit/code evidence; no browser E2E) | The app refreshes authoritative launch settings on a fixed 30-second interval, retries on failure, and cleans up the pending timeout. This is status polling, not a countdown: no ticking countdown UI or countdown calculation is implemented. |
| Admin access | PASS locally / NOT VERIFIED in production | Emulator custom-admin-claim reads pass; static rule tests preserve the three-email allowlist. Production identities and access remain unverified. |
| Vendor experience | PASS locally / NOT VERIFIED in production | The candidate allows vendor sign-in and approved-vendor dashboard, import, enquiry, and own-profile routes before launch. Frontend approval depends on the server-verified vendor-access check; backend routes independently verify approval and ownership. Production behavior is unverified. |
| Firestore raw product reads | PASS locally / NOT VERIFIED in production | Emulator denies anonymous/customer reads for pending/unpublished and unowned products; it allows an admin claim and an approved vendor only for a product with matching `sellerId`. The raw-read rule has no launch-time public grant, so anonymous access remains denied after launch by policy. The emulator cannot simulate a future request time; production rules are not published or verified. |
| Service worker / HTTP caching | PASS (local code/tests) | All `/api/public-products` responses carry `Cache-Control: no-store`; catalogue frontend fetches use `cache: "no-store"`. The existing service worker bypasses `/api/` and caches only its explicit shell URL allowlist, leaving unrelated static-asset behavior unchanged. Deployed behavior remains NOT VERIFIED; already-downloaded local Firestore data cannot be remotely revoked. |
| Current production behavior | FAIL (read-only GET on 2026-10-30) | Render `/health` 200; public settings 200 but missing three required launch fields; catalogue list 200 without Cache-Control; public reviews probe 200 pre-launch. A synthetic product detail and vendor-contact probe returned 404, so those deployed route behaviors remain NOT VERIFIED. |
| Live Hosting endpoints | FAIL (read-only GET on 2026-10-31) | `partswalaind.web.app` and `partswalaind.com` return 200 but reference different bundles (`index-DoXB2Cw6.js` vs `index-zNSfCvEH.js`). The custom-domain Login chunk returns a self-redirect; the same path on `web.app` returns `200 text/html` through the SPA fallback. Both HTML responses advertised `max-age=3600`. Firebase CLI confirms site IDs and the `partswalaind.web.app` default URL, but does not show the custom-domain association; owner must confirm it in Firebase Console. |

### Hosting build and asset consistency

- Local configuration is consistent: `.firebaserc` selects project `partswalaflutter`; `firebase.json` retains both `partswalaflutter` and `partswalaind` Hosting sites, and both publish the same `dist` directory with SPA fallback to `/index.html`. The default URL for the `partswalaind` site is `https://partswalaind.web.app`. Do not remove or repoint the older site.
- Firebase CLI read-only metadata lists both sites. It reports the `partswalaind` live release time as 2026-10-21 16:25:33 (CLI display time); this does not establish which site owns `partswalaind.com` or identify its deployed release.
- **Owner confirmation required:** Firebase CLI site and channel commands do not expose the attached custom-domain-to-site mapping or a definitive SSL certificate state. In Firebase Console, open project `partswalaflutter` → **Hosting** → **View** for each site (`partswalaind`, then `partswalaflutter`) → **Custom domains**. Confirm which site lists `partswalaind.com`, whether it redirects to another host, and that the domain status/certificate is connected and active. Record the site ID and displayed SSL/domain status; do not edit the domain or DNS.
- Both `firebase.json` site entries still publish shared `dist` and retain the existing security headers. Their SPA rewrite now excludes `/assets/**` using Firebase Hosting's negative-glob source: valid static files are served before rewrites, while a missing asset skips the SPA fallback and receives Hosting's default 404 (there is no custom `404.html`). Deep links outside `/assets/**` continue to rewrite to `/index.html`.
- Cache headers are separated by path: non-asset document/routes use `no-cache, max-age=0, must-revalidate`; fingerprinted Vite files under `/assets/**` use `public, max-age=31536000, immutable`. This retains HTML revalidation without preventing safe caching of hashed assets. These are local settings only and cannot repair the live `.com` self-redirect or take effect until an approved Hosting deployment.
- Do not treat HTTP 200 as proof a chunk exists. The build verifier checks HTML entry references; the Hosting Emulator regression additionally requests the entry JS/CSS and the lazy `Login-*.js` chunk, checks MIME types, confirms the SPA fallback still works, and verifies a missing asset returns 404 rather than the SPA document. The emulator test does not establish production cache headers or custom-domain routing; those still require post-deployment checks and owner confirmation.
- Safe local verification, without touching an existing ignored `dist`:

  ```powershell
  $buildDir = Join-Path $env:TEMP ('partswala-hosting-' + [guid]::NewGuid().ToString('N'))
  npm run build -- --outDir $buildDir
  if ($LASTEXITCODE -ne 0) { throw 'Build failed; stop.' }
  npm run verify:hosting-build -- $buildDir
  ```

  The verifier checks both configured site IDs share `dist`, have the asset-excluding SPA rewrite and disjoint cache rules, and every local `.js`/`.css` reference in generated `index.html` exists in the temporary build. For routing verification, run `scripts/hostingRouting.emulator.test.js` with Firebase Hosting Emulator, a temporary one-site config whose `public` path is the fresh build, `HOSTING_BUILD_DIR=$buildDir`, and project `demo-partswala-hosting`. Remove only temporary paths created for the run. Never build over ignored repository `dist`.

### Tests and build run for this review

All commands below were local; the emulator command used only `demo-partswalaind` on loopback. No handoff script, deployment, production mutation, or Firestore publication was performed.

| Command | Result |
|---|---|
| From `backend`: `npm test` | PASS — 229 tests: 226 passed, 0 failed, 3 emulator tests skipped because the suite was run without emulator environment variables. |
| From repository root: `node --test backend/publicSiteSettingsClient.test.js src/services/productService.test.js` | PASS — 13 tests, 0 failed, 0 skipped. |
| `npm run build -- --outDir C:\Users\tp\AppData\Local\Temp\partswala-ind-launch-audit-build-20261030-1638` | PASS — Vite transformed 181 modules and built successfully. Existing `dist` was not overwritten. Vite emitted its expected warning that an external `outDir` is not emptied. |
| `firebase emulators:exec --config <unique-temp>\firebase.json --project demo-partswalaind --only auth,firestore "node --test <absolute paths to firestoreLaunchGate.emulator.test.js, vendorEnquiries.emulator.test.js, vendorBulkImport.emulator.test.js>"` | PASS — 20 tests, 0 failed, 0 skipped. Candidate rules were copied to a new temporary emulator directory; emulator log output stayed outside the repository. |
| `npm test` from `backend` | PASS — 230 tests: 227 passed, 0 failed, 3 emulator tests skipped without emulator variables. |
| Focused launch/security suite: Firestore rules, catalogue, admin authorization, token auth, Cloudinary, enquiry, image and frontend API tests | PASS — 61 tests, 0 failed, 0 skipped. |
| All frontend-owned `src/**/*.test.js` files via `node --test <file list>` | PASS — 10 tests, 0 failed, 0 skipped. |
| `npm run build -- --outDir <unique-temp-dir>` followed by `npm run verify:hosting-build -- <same-temp-dir>` | PASS — latest run transformed 179 modules and verified all 4 JS/CSS references in generated `index.html`; both configured Hosting sites were confirmed to share `dist`; existing ignored `dist` was not overwritten. |
| `node --test scripts/verifyHostingBuild.test.js` | PASS — 3 tests: explicit fresh output required, all referenced assets present, and missing asset rejected. |
| Auth/Firestore emulator: `firestoreLaunchGate.emulator.test.js vendorEnquiries.emulator.test.js vendorBulkImport.emulator.test.js` using isolated `demo-partswalaind` | PASS — 21 tests, 0 failed, 0 skipped. |
| `npm run build -- --outDir C:\Users\tp\AppData\Local\Temp\partswala-launch-audit-build-2031ea3a723c49f2b63e3ff5e88a2c28` | PASS — Vite transformed 181 modules; output remained outside the worktree. |
| `git diff --check` | PASS — no whitespace errors; existing LF/CRLF notices were emitted. |

The emulator command used a fresh temporary working directory because `firestore-debug.log` already existed in the repository and must not be overwritten. The three emulator tests skipped by the plain backend suite all passed when rerun under the demo emulators. The frontend has no configured browser end-to-end test runner; no browser transition was claimed as end-to-end verified. Build output and emulator scratch files are outside the repository and are not release artifacts.

### Catalogue cache-control follow-up — 2026-10-30

These focused commands were run from `C:\Users\tp\Desktop\Partswala IND\partswala-launch-release` after adding no-store handling to the local catalogue routes and frontend product service:

| Command | Result |
|---|---|
| `node --test backend/publicProductCatalogRoutes.test.js` | PASS — 10 tests, 0 failed, 0 skipped. Coverage asserts no-store on pre-launch 403s, launch-time/post-launch list/detail/by-ID responses, malformed JSON parser errors, validation errors, and rate-limit responses. |
| `node --test src/services/productService.test.js backend/publicSiteSettingsClient.test.js` | PASS — 13 tests, 0 failed, 0 skipped. Product listing/detail fetches assert `cache: "no-store"`; pre-launch 403 errors are surfaced. Settings tests confirm their existing no-store behavior. |
| `npm run build -- --outDir C:\Users\tp\AppData\Local\Temp\partswala-catalog-cache-build-1166d999a1464b2db44be95409ce82e7` | PASS — Vite transformed 181 modules and built successfully; output is outside the worktree. Vite emitted the existing external-output warning and chunk-size advisory. |
| `git diff --check` | PASS — no whitespace errors; Git printed existing LF-to-CRLF notices for other modified files. |

These results verify the local candidate only. No service-worker code or unrelated static-asset caching behavior was changed; the existing worker returns without interception for `/api/` and uses an explicit allowlist for shell caching. No production request or deployment was performed.

### Final local completion pass — 2026-10-31

| Command/check | Result |
|---|---|
| `firebase emulators:exec --config firebase.json --project demo-partswalaind --only auth,firestore "npm --prefix backend test"` | PASS — 255 tests passed, 0 failed, 0 skipped. The demo project used local Auth and Firestore emulators only. |
| PowerShell enumeration of all `src\services\*.test.js` files followed by `node --test $tests` | PASS — 16 tests passed, 0 failed, 0 skipped, including catalogue privacy, backend URL resolution, vendor approval requests, enquiry/quote API clients, and image validation. Node also emitted a WebSocket port-in-use message; all tests still passed and the isolated vendor-access test passed separately. |
| `npm run build -- --outDir C:\Users\tp\AppData\Local\Temp\partswala-final-build-last-20261031` | PASS — Vite transformed 174 modules and completed in 3.67 seconds. The existing advisory for chunks above 500 kB remains; no build error occurred. Output stayed outside the repository. |
| `npm run lint` | PASS — no warnings or errors. |
| `git diff --check` | PASS — no whitespace errors; Git emitted existing LF/CRLF normalization notices. |
| Local browser, 375×812 viewport | PASS for mobile navigation visibility and Products navigation; no runtime page errors after restoring the missing assistant icon import. Catalogue data itself was unavailable because no local backend was running. |
| Isolated production-mode preview with `VITE_API_URL=https://candidate.invalid` | PASS for fail-closed gate behavior: a direct `/products/...` URL showed Coming Soon when settings could not be verified; the vendor sign-in link opened the sign-in form; mobile Coming Soon content had no horizontal overflow. This preview deliberately used a reserved invalid host and made no production API request. |

These are local candidate checks, not production verification. Vendor/admin sign-in and their full authenticated browser flows were not exercised in a browser because no test credentials were supplied; backend authorization was covered by the emulator suite. No deployment, Firestore publication, production-setting change, staging, or production mutation was performed.

## Launch instant and access policy

Target: **2026-11-08 00:00:00 IST**, equivalent to **2026-11-07T18:30:00.000Z**.

Before that instant, unauthenticated and ordinary customer access to public catalogue, seller contact/name lookup, public reviews, public AI product lookup, enquiry creation, checkout/order creation, and payment initiation/verification must be denied server-side. Admin login and authorized non-commerce management and approved-vendor workflows remain available under their existing authorization rules. Payment, refund, COD-collection, cancellation, and shipping callbacks/mutations fail closed while the permanent commerce lock is disabled; separately approve any future callback reconciliation policy before enabling it. The frontend Coming Soon gate exposes only vendor sign-in and approved-vendor dashboard, import, enquiry, and own-profile surfaces after server-verified approval. At and after the target, public marketplace API access should open without a redeployment; raw product documents must remain private and the public API must return sanitized products. The service worker bypasses API requests, and local API responses and frontend fetches use no-store where protected or launch-gated data is involved; production headers remain unverified and the earlier production observation lacked explicit cache control.

Firestore raw product reads are permitted only to admins or approved vendors whose UID matches the product's `sellerId`. The rule has no launch-time public grant, so anonymous/customer direct reads remain denied both before and after launch. Emulator tests verify anonymous/customer denial, admin reads, approved vendor own-product reads, and cross-vendor denial. The emulator's request clock is pre-launch; this rule is time-independent. Production rules remain unverified until the operator confirms the deployed ruleset read-only.

## Release preparation — authorized operator only

1. **Keep the launch blocked until all blockers below are closed.** This runbook authorizes no deployment or production changes.
2. In the Render Dashboard, inspect the service whose configured custom/public hostname is `partswala-ind.onrender.com`. Record the service name and ID, Git repository URL, branch, root directory, runtime, build command, start command, health-check path, auto-deploy setting, and latest deployed commit. Inspect environment variable names for presence only; never reveal or copy values. Confirm the hostname from the service settings rather than inferring the service from its URL.
3. Compare the Render repository and branch with the verified local `origin` and candidate branch. Confirm the exact reviewed release commit through the normal release process. The current HEAD is only a base revision and excludes dirty working-tree changes; do not deploy it as the candidate or guess a commit.
4. In Firebase Console, select project `partswalaflutter`, open **Hosting**, and inspect both configured sites (`partswalaflutter` and `partswalaind`). Open each site's **Custom domains** view and confirm which site, if any, owns `partswalaind.com`, its domain verification and certificate state, and the canonical `web.app` domain. Record the site ID and association. Repository configuration and DNS records alone do not prove this mapping.
5. Compare the deployed asset references at `partswalaind.com`, `partswalaflutter.web.app`, and `partswalaind.web.app` with the reviewed build. Resolve any mismatch before selecting a deployment target. Do not change DNS, Firebase settings, or production hosting configuration during this inspection.
6. Confirm with the release owner whether backend deployment, Firestore rule publication, and Hosting deployment are separate approvals/actions, and obtain the approved rollback procedure. No action is authorized by this runbook.
7. Confirm the launch target is consistent in reviewed backend/frontend code. Raw product Firestore rules do not unlock at launch; the public marketplace unlocks through the backend API only. Do not change production launch settings, DNS, or rules during verification.

## Reproducible candidate handoff without changing this worktree

Current inventory at the last audit: **29 modified tracked files, 17 untracked files, 0 staged files**. Recheck all values before capture; this is a dirty worktree and its base `HEAD` is not a release commit. These commands are proposed documentation, have not been executed or runtime-tested, and must not be run without explicit operator review and approval. Capture and application are separate write operations: capture creates a new handoff directory; application modifies only the approved clean clone. Neither operation may modify the original source worktree, and neither authorizes staging, committing, pushing, deployment, or production changes.

Prerequisites: use Windows PowerShell 7 or later and Git for Windows; confirm both versions before approval. The source must be the stated launch worktree, its origin URL and branch must be independently confirmed, and its exact `HEAD` must equal the declared base. Inspect ignored files first; the capture does not include them. The destination parent must already exist, be operator-approved, and have no reparse-point components. For application, the handoff manifest hash must have been recorded independently, and the destination must be a separate, new, clean clone at the declared repository, branch, and base. Do not execute a pasted script unless its full contents, placeholders, destinations, and expected writes have been reviewed.

The scripts use absolute paths and `git -C`, so PowerShell's current working directory is not significant. Run each complete code block in a fresh PowerShell 7 session; do not splice blocks or reuse a session containing stale variables.

The capture excludes Git metadata (`.git`), ignored/generated `node_modules`, `backend/node_modules`, `dist`, and `firestore-debug.log`; Git-ignored files are not included. Before capture, inspect `git status --ignored --short` and confirm no other ignored path contains a required deliverable. The manifest must inventory every tracked path in the resulting Git tree, every tracked file's SHA-256, every tracked change relative to `HEAD` (including staged additions), every non-ignored untracked file and its SHA-256, and the binary-capable tracked patch. Renames are represented as a delete plus an add so the patch reconstructs the exact resulting tree. A temporary Git index compares the complete source and patch trees, including modes and binary blobs.

The scripts reject reparse points (including symlinks and junctions) on relevant source, handoff, clone, and file paths; reject unsafe or colliding relative paths; canonicalize destinations; and check that each copied path stays under its approved root. Capture requires a nonexistent destination outside the source. Application requires the handoff and a separate, clean clone at the declared repository, branch, and base commit; it validates the complete handoff before the first clone write.

The source worktree must remain quiescent throughout capture: close editors and stop formatters, builds, tests, sync clients, and other writers. The script holds read-only sharing locks on enumerated files, watches for filesystem changes, and compares fingerprints, inventories, status, branch, HEAD, repository URL, and patch consistency immediately before success. These checks detect many races but cannot guarantee protection from new-file races, watcher overflow, or filesystem/filter-driver behavior. Any lock failure, watcher error/event, inventory discrepancy, or fingerprint/status/patch/tree mismatch is a hard stop. Never interpret a partial handoff or clone as verified.

The captured handoff must likewise remain quiescent during application. The application opens every inventoried handoff file with read-only sharing locks, then rechecks the manifest, patch/list/tree hashes, untracked-file hashes, and complete handoff inventory while those locks are held. Concurrent additions and filesystem races cannot be absolutely prevented; any failed lock or mismatch is a hard stop.

The capture's initial Git/path/hash checks are read-only. The first write is creation of the new handoff directory; subsequent writes are confined to that directory, including copied untracked files, patch/list/manifest/tree files, and temporary verification files. The application performs its handoff, repository, path, hash, and patch/tree preflight before changing the clone working tree. Its patch/tree preflight writes only a unique temporary index/object directory under the system temp directory and removes that specific temporary directory on completion. `APPLICATION STARTED` marks the first clone working-tree modification. After that marker, patch application, untracked-file copies, and verification may change the clone; failures are non-transactional and require inspection, not automatic cleanup.

Expected successful output is `HANDOFF VERIFIED` plus the independently recorded manifest hash, then—only in a separately approved application—`PREFLIGHT VERIFIED`, `APPLICATION VERIFIED`, the matching tracked-tree ID, and tracked/untracked counts. Any other output, thrown error, nonzero command, or missing expected marker is a failed/incomplete operation. A failed capture leaves the new handoff for inspection. A failed preflight must leave the clone working tree untouched; inspect the error and preserve any temporary verification directory still present under the system temp path. A failure after `APPLICATION STARTED` may leave a partially changed clone; stop, preserve it, record the error/status, and request a recovery decision. Never retry blindly on that clone.

Record the final operator evidence outside the source worktree: source repository/branch/base, initial and final Git status, manifest SHA-256, patch and path-list SHA-256 values, tracked-tree ID/hash, tracked/untracked counts, canonical handoff/clone paths, output markers, and any failure/status. Never include credentials, environment-variable values, or customer data. Label the outcome **HANDOFF VERIFIED** or **HANDOFF APPLICATION VERIFIED** only; do not label it **RELEASE CANDIDATE VERIFIED** without separate review, test/build evidence, production-target confirmation, and release-owner approval.

### Proposed capture commands — do not execute before approval

Use the current expected base below only if it still matches `git rev-parse HEAD`. Choose a unique handoff path outside the repository. The script refuses any existing handoff path, including an empty directory.

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\tp\Desktop\Partswala IND\partswala-launch-release'
$Handoff = 'C:\Users\tp\Desktop\PartswalaIND-release-handoff-REPLACE-WITH-UNIQUE-ID'
$ExpectedBase = 'c7e889f87860b261d99aeb3e556829d71acc90ce'
$ExpectedBranch = 'release/partswala-launch-20261021'
$ExpectedRepository = 'https://github.com/harshgamerz976-alt/partswala-ind.git'

$sourceFull = [IO.Path]::GetFullPath($Source).TrimEnd('\')
$handoffFull = [IO.Path]::GetFullPath($Handoff).TrimEnd('\')
if ($Handoff -match 'REPLACE-WITH|<|>' -or
    -not [IO.Path]::IsPathRooted($Handoff)) {
  throw 'Replace every placeholder and use an absolute, operator-approved destination.'
}
$handoffParent = Split-Path -Parent $handoffFull
if (-not (Test-Path -LiteralPath $handoffParent -PathType Container)) {
  throw 'Handoff parent directory must already exist.'
}
function Assert-NoReparsePath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $current = $root
  $relative = $fullPath.Substring($root.Length)
  foreach ($part in ($relative -split '[\\/]' | Where-Object { $_ })) {
    $current = Join-Path $current $part
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing reparse point in path: $current"
      }
    } else {
      break
    }
  }
}
function Assert-SafeRelativePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or
      $Path -match '[\x00-\x1f\t"<>:|?*]' -or $Path.Contains('\')) {
    throw "Unsafe repository-relative path: $Path"
  }
  if ($Path -match '(^|/)(?:\.git|node_modules|dist)(/|$)|(^|/)firestore-debug\.log$') {
    throw "Repository-relative path is excluded from the handoff: $Path"
  }
  $parts = $Path.Split('/')
  foreach ($part in $parts) {
    if (-not $part -or $part -in @('.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or
        $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$') {
      throw "Unsafe repository-relative path component: $Path"
    }
  }
}
function Assert-UniqueRelativePaths([string[]]$Paths) {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($path in $Paths) {
    Assert-SafeRelativePath $path
    if (-not $seen.Add($path)) { throw "Case-insensitive path collision: $path" }
  }
}
function Assert-CredentialFreeRepositoryUrl([string]$Url) {
  $uri = $null
  $isAbsoluteUri = [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)
  $credentialedSshUser = $isAbsoluteUri -and $uri.Scheme -in @('ssh', 'git+ssh') -and $uri.UserInfo -ceq 'git'
  if ($isAbsoluteUri -and
      (($uri.UserInfo -and -not $credentialedSshUser) -or $uri.Query -or $uri.Fragment)) {
    throw 'Repository URL must not contain credentials, query parameters, or fragments.'
  }
  if ($Url.Contains('?') -or $Url.Contains('#') -or $Url -match '^[^/]+:[^/]+@[^:]+:') {
    throw 'Repository URL appears to contain embedded credentials.'
  }
  if ($Url -match '^([^/]+)@[^:]+:' -and $Matches[1] -cne 'git') {
    throw 'Use the standard credential-free git SSH username or a credential-free HTTPS repository URL.'
  }
}
function Assert-WithinRoot([string]$Path, [string]$Root) {
  $canonicalPath = [IO.Path]::GetFullPath($Path)
  $canonicalRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $canonicalPath.StartsWith($canonicalRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved path is outside approved root: $canonicalPath"
  }
}
Assert-NoReparsePath $Source
Assert-NoReparsePath $handoffParent
$sourceTopLevel = (& git -C $Source rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceTopLevel) { throw 'Could not resolve source Git root.' }
if ([IO.Path]::GetFullPath($sourceTopLevel).TrimEnd('\') -ine $sourceFull) {
  throw 'Source path must be the repository top-level directory, not a subdirectory.'
}
if ($handoffFull -eq $sourceFull -or
    $handoffFull.StartsWith($sourceFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $sourceFull.StartsWith($handoffFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Handoff destination must be separate from and outside the source repository.'
}
if (Test-Path -LiteralPath $Handoff) { throw "Handoff destination already exists: $Handoff" }
$head = (& git -C $Source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -cne $ExpectedBase) { throw "Source base mismatch: $head" }
$branch = (& git -C $Source branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -cne $ExpectedBranch) { throw "Source branch mismatch: $branch" }
$repository = (& git -C $Source remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $repository -cne $ExpectedRepository) { throw 'Source origin does not match the operator-confirmed repository URL.' }
Assert-CredentialFreeRepositoryUrl $repository
$statusBefore = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Could not read source Git status.' }

function Get-SourceFingerprint {
  $tracked = @(& git -C $Source ls-files)
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate tracked files.' }
  $untracked = @(& git -C $Source ls-files --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate untracked files.' }
  $rows = foreach ($kind in @('tracked', 'untracked')) {
    $paths = if ($kind -eq 'tracked') { $tracked } else { $untracked }
    foreach ($relativePath in $paths) {
      Assert-SafeRelativePath $relativePath
      $fullPath = Join-Path $Source $relativePath
      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        if ($kind -eq 'tracked') { "$kind`t$relativePath`tMISSING" }
        else { throw "Untracked source disappeared: $relativePath" }
        continue
      }
      Assert-NoReparsePath $fullPath
      $item = Get-Item -LiteralPath $fullPath -Force
      $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
      "$kind`t$relativePath`t$hash"
    }
  }
  @($rows | Sort-Object)
}

$trackedChanged = @(& git -C $Source diff --no-renames --name-only HEAD)
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate tracked changes against HEAD.' }
$untrackedFiles = @(& git -C $Source ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate untracked files.' }
$capturePaths = @($trackedChanged) + @($untrackedFiles)
Assert-UniqueRelativePaths $capturePaths
Assert-UniqueRelativePaths $untrackedFiles
if ($capturePaths | Where-Object { $_ -match '(^|[\\/])(\.git|node_modules|dist)([\\/]|$)|(^|[\\/])firestore-debug\.log$' }) {
  throw 'Ignored repository metadata, dependency/build output, or emulator logs appeared in the source manifest.'
}
$fingerprintBeforeWatcher = @(Get-SourceFingerprint)

New-Item -ItemType Directory -Path $Handoff | Out-Null
Assert-NoReparsePath $Handoff
$events = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$watcher = [IO.FileSystemWatcher]::new($Source)
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size, CreationTime'
$watcher.InternalBufferSize = 65536
$onFileEvent = {
  param($sender, $eventArgs)
  $relative = [IO.Path]::GetRelativePath($Source, $eventArgs.FullPath)
  if ($relative -notmatch '(^|[\\/])(\.git|node_modules|dist)([\\/]|$)|(^|[\\/])firestore-debug\.log$') {
    [void]$events.Enqueue($relative)
  }
}.GetNewClosure()
$onWatcherError = {
  param($sender, $eventArgs)
  [void]$events.Enqueue('WATCHER_ERROR: ' + $eventArgs.GetException().Message)
}.GetNewClosure()
$fileHandler = [IO.FileSystemEventHandler]$onFileEvent
$renameHandler = [IO.RenamedEventHandler]$onFileEvent
$errorHandler = [IO.ErrorEventHandler]$onWatcherError
$watcher.add_Changed($fileHandler)
$watcher.add_Created($fileHandler)
$watcher.add_Deleted($fileHandler)
$watcher.add_Renamed($renameHandler)
$watcher.add_Error($errorHandler)
$watcher.EnableRaisingEvents = $true
$sourceLocks = [Collections.Generic.List[IO.FileStream]]::new()

try {
  if (-not $events.IsEmpty) { throw 'Source changed while initializing the capture watcher.' }
  $statusAtCapture = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh source Git status after watcher initialization.' }
  $trackedAtCapture = @(& git -C $Source diff --no-renames --name-only HEAD)
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh tracked paths after watcher initialization.' }
  $untrackedAtCapture = @(& git -C $Source ls-files --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh untracked paths after watcher initialization.' }
  if (($statusBefore -join "`n") -cne ($statusAtCapture -join "`n") -or
      (@($trackedChanged | Sort-Object) -join "`n") -cne (@($trackedAtCapture | Sort-Object) -join "`n") -or
      (@($untrackedFiles | Sort-Object) -join "`n") -cne (@($untrackedAtCapture | Sort-Object) -join "`n")) {
    throw 'Source Git manifest changed during capture initialization.'
  }
  $trackedChanged = $trackedAtCapture
  $untrackedFiles = $untrackedAtCapture
  $statusBefore = $statusAtCapture
  $allSourcePaths = @(& git -C $Source ls-files)
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate tracked files for locking.' }
  $allSourcePaths += $untrackedFiles
  foreach ($relativePath in $allSourcePaths) {
    $fullPath = Join-Path $Source $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Source disappeared before locking: $relativePath" }
    Assert-NoReparsePath $fullPath
    $item = Get-Item -LiteralPath $fullPath -Force
    $sourceLocks.Add([IO.File]::Open($fullPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read))
  }
  if (-not $events.IsEmpty) { throw 'Source changed while acquiring source file locks.' }
  $fingerprintBefore = @(Get-SourceFingerprint)
  if (($fingerprintBeforeWatcher -join "`n") -cne ($fingerprintBefore -join "`n")) {
    throw 'Source fingerprint changed while initializing capture locks.'
  }
  if (-not $events.IsEmpty) { throw 'Source changed while recording the capture baseline.' }
  $patchPath = Join-Path $Handoff 'candidate-tracked.patch'
  & git -C $Source diff --binary --no-renames HEAD --output=$patchPath
  if ($LASTEXITCODE -ne 0) { throw 'Tracked patch generation failed.' }
  Assert-NoReparsePath $patchPath
  $trackedListPath = Join-Path $Handoff 'tracked-change-paths.txt'
  [IO.File]::WriteAllLines($trackedListPath, [string[]]$trackedChanged, [Text.UTF8Encoding]::new($false))
  Assert-NoReparsePath $trackedListPath
  $untrackedListPath = Join-Path $Handoff 'untracked-paths.txt'
  [IO.File]::WriteAllLines($untrackedListPath, [string[]]$untrackedFiles, [Text.UTF8Encoding]::new($false))
  Assert-NoReparsePath $untrackedListPath
  $untrackedRoot = Join-Path $Handoff 'untracked'
  New-Item -ItemType Directory -Path $untrackedRoot | Out-Null
  Assert-NoReparsePath $untrackedRoot
  $entries = [Collections.Generic.List[object]]::new()

  foreach ($relativePath in $trackedChanged) {
    $sourcePath = Join-Path $Source $relativePath
    $sourceHash = if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
      (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $null }
    $entries.Add([pscustomobject]@{ kind = 'tracked-change'; path = $relativePath; sourceSha256 = $sourceHash; handoffSha256 = $null })
  }
  foreach ($relativePath in $untrackedFiles) {
    $sourcePath = Join-Path $Source $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Untracked source is not a file: $relativePath" }
    Assert-NoReparsePath $sourcePath
    $handoffPath = Join-Path $untrackedRoot $relativePath
    $parent = Split-Path -Parent $handoffPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Assert-NoReparsePath $parent
    $handoffCanonical = [IO.Path]::GetFullPath($handoffPath)
    Assert-WithinRoot $handoffCanonical $handoffFull
    if (Test-Path -LiteralPath $handoffCanonical) { throw "Handoff destination collision: $relativePath" }
    Copy-Item -LiteralPath $sourcePath -Destination $handoffPath
    Assert-NoReparsePath $handoffPath
    Assert-WithinRoot $handoffPath $handoffFull
    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $handoffHash = (Get-FileHash -LiteralPath $handoffPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -cne $handoffHash) { throw "Untracked copy hash mismatch: $relativePath" }
    $entries.Add([pscustomobject]@{ kind = 'untracked'; path = $relativePath; sourceSha256 = $sourceHash; handoffSha256 = $handoffHash })
  }

  $patchHash = (Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $trackedAfterCapture = @(& git -C $Source diff --no-renames --name-only HEAD)
  if ($LASTEXITCODE -ne 0 -or (@($trackedAfterCapture | Sort-Object) -join "`n") -cne (@($trackedChanged | Sort-Object) -join "`n")) {
    throw 'Tracked patch path set changed during capture.'
  }
  $manifest = [pscustomobject]@{
    baseHead = $head
    branch = $branch
    trackedChangePaths = @($trackedChanged)
    untrackedPaths = @($untrackedFiles)
    entries = @($entries)
    repositoryUrl = $repository
    patchSha256 = $patchHash
    trackedPathListSha256 = (Get-FileHash -LiteralPath $trackedListPath -Algorithm SHA256).Hash.ToLowerInvariant()
    untrackedPathListSha256 = (Get-FileHash -LiteralPath $untrackedListPath -Algorithm SHA256).Hash.ToLowerInvariant()
    trackedFingerprint = @($fingerprintBefore | Where-Object { $_.StartsWith("tracked`t", [StringComparison]::Ordinal) })
    fingerprintBefore = @($fingerprintBefore)
    gitStatusBefore = @($statusBefore)
    trackedTreeId = ''
    trackedInventory = @()
    trackedTreeSha256 = ''
  }
  $manifestPath = Join-Path $Handoff 'manifest.json'
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Assert-NoReparsePath $manifestPath
  $manifestRead = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

  # Compare Git trees built independently from the source worktree and the captured patch.
  $sourceIndex = Join-Path $Handoff 'verify-source.index'
  $patchIndex = Join-Path $Handoff 'verify-patch.index'
  $sourceObjects = (& git -C $Source rev-parse --path-format=absolute --git-path objects).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceObjects) { throw 'Could not resolve the source Git object directory.' }
  Assert-NoReparsePath $sourceObjects
  $verificationRoot = Join-Path ([IO.Path]::GetTempPath()) ('partswala-capture-verify-' + [guid]::NewGuid().ToString('N'))
  $tempRootFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $verificationRoot = [IO.Path]::GetFullPath($verificationRoot).TrimEnd('\')
  if ((Test-Path -LiteralPath $verificationRoot) -or
      -not ($verificationRoot.StartsWith($tempRootFull + '\', [StringComparison]::OrdinalIgnoreCase))) {
    throw 'Capture verification directory is not new and inside the system temp root.'
  }
  foreach ($protectedRoot in @($sourceFull, $handoffFull)) {
    if ($verificationRoot -eq $protectedRoot -or
        $verificationRoot.StartsWith($protectedRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $protectedRoot.StartsWith($verificationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Capture verification directory overlaps the source or handoff.'
    }
  }
  $verificationObjects = Join-Path $verificationRoot 'objects'
  $previousIndex = $env:GIT_INDEX_FILE
  $previousObjectDirectory = $env:GIT_OBJECT_DIRECTORY
  $previousAlternates = $env:GIT_ALTERNATE_OBJECT_DIRECTORIES
  try {
    New-Item -ItemType Directory -Path $verificationObjects -Force | Out-Null
    Assert-NoReparsePath $verificationRoot
    Assert-NoReparsePath $verificationObjects
    $env:GIT_OBJECT_DIRECTORY = $verificationObjects
    $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $sourceObjects
    $env:GIT_INDEX_FILE = $sourceIndex
    & git -C $Source read-tree $head
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize source verification index.' }
    & git -C $Source add -A -- .
    if ($LASTEXITCODE -ne 0) { throw 'Could not record source working-tree state in the temporary index.' }
    foreach ($relativePath in $untrackedFiles) {
      & git -C $Source rm --cached --ignore-unmatch -- $relativePath
      if ($LASTEXITCODE -ne 0) { throw "Could not exclude untracked file from tracked-tree verification: $relativePath" }
    }
    $sourceTree = (& git -C $Source write-tree).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not create source working-tree tree.' }

    $env:GIT_INDEX_FILE = $patchIndex
    & git -C $Source read-tree $head
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize patch verification index.' }
    & git -C $Source apply --cached --binary $patchPath
    if ($LASTEXITCODE -ne 0) { throw 'Captured tracked patch does not apply to the expected base.' }
    $patchTree = (& git -C $Source write-tree).Trim()
    if ($LASTEXITCODE -ne 0 -or $patchTree -cne $sourceTree) {
      throw 'Captured patch does not exactly reproduce the tracked source working-tree state.'
    }
    $trackedTreePath = Join-Path $Handoff 'tracked-tree.txt'
    $trackedTreeLines = @(& git -C $Source ls-tree -r --full-tree $sourceTree)
    if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate the complete resulting tracked tree.' }
    foreach ($treeLine in $trackedTreeLines) {
      if ($treeLine -notmatch '^100(?:644|755) blob (?:[0-9a-f]{40}|[0-9a-f]{64})\t(.+)$') {
        throw "Unexpected tracked-tree record; submodules and non-regular entries are not supported: $treeLine"
      }
      Assert-SafeRelativePath $Matches[1]
    }
    [IO.File]::WriteAllLines($trackedTreePath, [string[]]$trackedTreeLines, [Text.UTF8Encoding]::new($false))
    Assert-NoReparsePath $trackedTreePath
    $manifest.trackedTreeId = $sourceTree
    $manifest.trackedInventory = @($trackedTreeLines)
    $manifest.trackedTreeSha256 = (Get-FileHash -LiteralPath $trackedTreePath -Algorithm SHA256).Hash.ToLowerInvariant()
  } finally {
    $env:GIT_INDEX_FILE = $previousIndex
    $env:GIT_OBJECT_DIRECTORY = $previousObjectDirectory
    $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $previousAlternates
    foreach ($indexPath in @($sourceIndex, $patchIndex)) {
      if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
        Remove-Item -LiteralPath $indexPath
      }
    }
    if (Test-Path -LiteralPath $verificationRoot -PathType Container) {
      Remove-Item -LiteralPath $verificationRoot -Recurse -Force
    }
  }

  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  $manifestRead = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

  $trackedHashByPath = @{}
  foreach ($fingerprintRow in $manifestRead.trackedFingerprint) {
    $fields = $fingerprintRow -split "`t", 3
    if ($fields.Count -ne 3 -or $fields[0] -cne 'tracked' -or
        ($fields[2] -cne 'MISSING' -and $fields[2] -notmatch '^[0-9a-f]{64}$')) {
      throw 'Tracked source fingerprint is malformed.'
    }
    if ($trackedHashByPath.ContainsKey($fields[1])) { throw "Duplicate tracked fingerprint path: $($fields[1])" }
    $trackedHashByPath[$fields[1]] = $fields[2]
  }
  foreach ($entry in $manifestRead.entries | Where-Object kind -eq 'tracked-change') {
    if (-not $trackedHashByPath.ContainsKey($entry.path)) {
      throw "Tracked change is missing from the complete source fingerprint: $($entry.path)"
    }
    $fingerprintHash = $trackedHashByPath[$entry.path]
    if (($null -eq $entry.sourceSha256 -and $fingerprintHash -cne 'MISSING') -or
        ($null -ne $entry.sourceSha256 -and $entry.sourceSha256 -cne $fingerprintHash)) {
      throw "Tracked change hash does not match the complete source fingerprint: $($entry.path)"
    }
  }

  Start-Sleep -Milliseconds 500
  $fingerprintAfter = @(Get-SourceFingerprint)
  $patchAfterPath = Join-Path $Handoff 'verify-current.patch'
  & git -C $Source diff --binary --no-renames HEAD --output=$patchAfterPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not re-read tracked patch immediately before capture verification.' }
  if ((Get-FileHash -LiteralPath $patchAfterPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.patchSha256) {
    throw 'Source tracked patch changed during capture.'
  }
  $statusAfter = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not re-read source Git status.' }
  if (($fingerprintBefore -join "`n") -cne ($fingerprintAfter -join "`n")) { throw 'Source fingerprint changed during capture.' }
  if (($statusBefore -join "`n") -cne ($statusAfter -join "`n")) { throw 'Git status changed during capture.' }
  if (-not $events.IsEmpty) { throw "Source filesystem changed during capture: $(@($events.ToArray()) -join ', ')" }

  $manifestTracked = @($manifestRead.entries | Where-Object kind -eq 'tracked-change' | ForEach-Object path | Sort-Object)
  $manifestUntracked = @($manifestRead.entries | Where-Object kind -eq 'untracked' | ForEach-Object path | Sort-Object)
  if (($manifestTracked -join "`n") -cne (@($trackedChanged | Sort-Object) -join "`n")) { throw 'Tracked-change manifest is incomplete.' }
  if (($manifestUntracked -join "`n") -cne (@($untrackedFiles | Sort-Object) -join "`n")) { throw 'Untracked-file manifest is incomplete.' }
  foreach ($entry in $manifestRead.entries | Where-Object kind -eq 'untracked') {
    $destination = Join-Path $untrackedRoot $entry.path
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $entry.sourceSha256 -or $actual -cne $entry.handoffSha256) { throw "Manifest/destination hash mismatch: $($entry.path)" }
  }
  if ((Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.patchSha256) {
    throw 'Tracked patch hash mismatch.'
  }
  if ((Get-FileHash -LiteralPath $trackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.trackedPathListSha256) {
    throw 'Tracked path list hash mismatch.'
  }
  if ((Get-FileHash -LiteralPath $untrackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.untrackedPathListSha256) {
    throw 'Untracked path list hash mismatch.'
  }
  $trackedTreePath = Join-Path $Handoff 'tracked-tree.txt'
  if ((Get-FileHash -LiteralPath $trackedTreePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.trackedTreeSha256) {
    throw 'Complete tracked-tree inventory hash mismatch.'
  }
  $actualCopiedPaths = @(
    Get-ChildItem -LiteralPath $untrackedRoot -Force -Recurse |
      ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Reparse point found in captured untracked tree: $($_.FullName)"
        }
        if (-not $_.PSIsContainer) {
          [IO.Path]::GetRelativePath($untrackedRoot, $_.FullName).Replace('\', '/')
        }
      } | Sort-Object
  )
  if (($actualCopiedPaths -join "`n") -cne (@($untrackedFiles | Sort-Object) -join "`n")) {
    throw 'Captured untracked-file inventory contains missing or unexpected files.'
  }
  $fingerprintFinal = @(Get-SourceFingerprint)
  $statusFinal = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not re-read source Git status at final capture preflight.' }
  & git -C $Source diff --binary --no-renames HEAD --output=$patchAfterPath
  if ($LASTEXITCODE -ne 0 -or
      (Get-FileHash -LiteralPath $patchAfterPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.patchSha256) {
    throw 'Tracked patch consistency check failed at final capture preflight.'
  }
  if (($fingerprintBefore -join "`n") -cne ($fingerprintFinal -join "`n") -or
      ($statusBefore -join "`n") -cne ($statusFinal -join "`n")) {
    throw 'Source fingerprint or Git status changed before capture success.'
  }
  if (-not $events.IsEmpty) { throw "Source filesystem changed before capture success: $(@($events.ToArray()) -join ', ')" }
  Remove-Item -LiteralPath $patchAfterPath
  $expectedHandoffFiles = @(
    'candidate-tracked.patch',
    'tracked-change-paths.txt',
    'untracked-paths.txt',
    'tracked-tree.txt',
    'manifest.json'
  ) + @($untrackedFiles | ForEach-Object { "untracked/$_" })
  $actualHandoffFiles = @(
    Get-ChildItem -LiteralPath $Handoff -Force -Recurse |
      ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Reparse point found in handoff: $($_.FullName)"
        }
        if (-not $_.PSIsContainer) {
          [IO.Path]::GetRelativePath($Handoff, $_.FullName).Replace('\', '/')
        }
      } | Sort-Object
  )
  if (($actualHandoffFiles -join "`n") -cne (@($expectedHandoffFiles | Sort-Object) -join "`n")) {
    throw 'Handoff contains missing or unexpected files.'
  }
  $headFinal = (& git -C $Source rev-parse HEAD).Trim()
  $branchFinal = (& git -C $Source branch --show-current).Trim()
  $repositoryFinal = (& git -C $Source remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $headFinal -cne $head -or $branchFinal -cne $branch -or $repositoryFinal -cne $repository) {
    throw 'Source repository, branch, or base revision changed before capture success.'
  }
  $fingerprintImmediatelyBeforeSuccess = @(Get-SourceFingerprint)
  $statusImmediatelyBeforeSuccess = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not read final source Git status.' }
  $lastPatchPath = Join-Path $Handoff 'verify-current.patch'
  & git -C $Source diff --binary --no-renames HEAD --output=$lastPatchPath
  if ($LASTEXITCODE -ne 0 -or
      (Get-FileHash -LiteralPath $lastPatchPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.patchSha256) {
    throw 'Final source patch verification failed.'
  }
  Remove-Item -LiteralPath $lastPatchPath
  $actualHandoffFiles = @(
    Get-ChildItem -LiteralPath $Handoff -Force -Recurse |
      ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Reparse point found in final handoff inventory: $($_.FullName)"
        }
        if (-not $_.PSIsContainer) {
          [IO.Path]::GetRelativePath($Handoff, $_.FullName).Replace('\', '/')
        }
      } | Sort-Object
  )
  if (($actualHandoffFiles -join "`n") -cne (@($expectedHandoffFiles | Sort-Object) -join "`n")) {
    throw 'Final handoff inventory contains missing or unexpected files.'
  }
  $fingerprintImmediatelyBeforeSuccess = @(Get-SourceFingerprint)
  $statusImmediatelyBeforeSuccess = @(& git --no-optional-locks -C $Source status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not read final source Git status.' }
  $lastPatchPath = Join-Path $Handoff 'verify-current.patch'
  & git -C $Source diff --binary --no-renames HEAD --output=$lastPatchPath
  if ($LASTEXITCODE -ne 0 -or
      (Get-FileHash -LiteralPath $lastPatchPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestRead.patchSha256) {
    throw 'Final source patch verification failed.'
  }
  Remove-Item -LiteralPath $lastPatchPath
  if (($fingerprintBefore -join "`n") -cne ($fingerprintImmediatelyBeforeSuccess -join "`n") -or
      ($statusBefore -join "`n") -cne ($statusImmediatelyBeforeSuccess -join "`n") -or
      -not $events.IsEmpty) {
    throw 'Source changed during final capture verification; handoff is not verified.'
  }
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "Record this manifest SHA-256 outside the handoff: $manifestHash"
  "Verified tracked Git tree: $sourceTree"
  "Verified tracked changes: $($trackedChanged.Count); untracked files: $($untrackedFiles.Count)"
  'HANDOFF VERIFIED: captured files, tracked patch, inventory, and integrity checks match.'
  'RELEASE CANDIDATE NOT VERIFIED: review, builds/tests, deployment target, and production checks remain separate.'
}
finally {
  foreach ($sourceLock in $sourceLocks) { $sourceLock.Dispose() }
  $watcher.EnableRaisingEvents = $false
  $watcher.remove_Changed($fileHandler)
  $watcher.remove_Created($fileHandler)
  $watcher.remove_Deleted($fileHandler)
  $watcher.remove_Renamed($renameHandler)
  $watcher.remove_Error($errorHandler)
  $watcher.Dispose()
}
```

### Create the separate clean clone — later approval required

Only after explicit approval, choose an existing, approved parent directory outside the source and handoff. The final clone path must not exist. The clone starts from the exact declared base commit; it does not assume the candidate branch has been pushed. If a local branch with the expected name already exists in the fresh clone at a different commit, stop and preserve the clone rather than resetting or replacing that branch.

```powershell
$ErrorActionPreference = 'Stop'
$ExpectedRepository = 'https://github.com/harshgamerz976-alt/partswala-ind.git'
$ExpectedBranch = 'release/partswala-launch-20261021'
$ExpectedBase = 'c7e889f87860b261d99aeb3e556829d71acc90ce'
$Source = 'C:\Users\tp\Desktop\Partswala IND\partswala-launch-release'
$Handoff = 'C:\Users\tp\Desktop\PartswalaIND-release-handoff-REPLACE-WITH-UNIQUE-ID'
$CloneParent = 'C:\Users\tp\Desktop'
$Clone = Join-Path $CloneParent 'partswala-release-clone-REPLACE-WITH-UNIQUE-ID'
if ($Clone -match 'REPLACE-WITH|<|>' -or $Handoff -match 'REPLACE-WITH|<|>' -or
    -not [IO.Path]::IsPathRooted($Clone) -or -not [IO.Path]::IsPathRooted($Handoff)) {
  throw 'Choose unique absolute clone and handoff paths and replace every placeholder.'
}
if (-not (Test-Path -LiteralPath $CloneParent -PathType Container)) { throw 'Clone parent must already exist.' }
if (Test-Path -LiteralPath $Clone) { throw "Clone destination already exists; refusing to overwrite: $Clone" }
if (-not (Test-Path -LiteralPath $Source -PathType Container) -or
    -not (Test-Path -LiteralPath $Handoff -PathType Container)) {
  throw 'Source worktree and verified handoff must both exist before clone creation.'
}
$cloneFull = [IO.Path]::GetFullPath($Clone).TrimEnd('\')
$sourceFull = [IO.Path]::GetFullPath($Source).TrimEnd('\')
$handoffFull = [IO.Path]::GetFullPath($Handoff).TrimEnd('\')
$cloneParentFull = [IO.Path]::GetFullPath($CloneParent).TrimEnd('\')
function Assert-NoReparsePath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $current = $root
  foreach ($part in ($fullPath.Substring($root.Length) -split '[\\/]' | Where-Object { $_ })) {
    $current = Join-Path $current $part
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing reparse point in clone path: $current"
      }
    } else {
      break
    }
  }
}
Assert-NoReparsePath $sourceFull
Assert-NoReparsePath $handoffFull
Assert-NoReparsePath $cloneParentFull
if ($cloneFull -eq $sourceFull -or $cloneFull.StartsWith($sourceFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $sourceFull.StartsWith($cloneFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $cloneFull -eq $handoffFull -or $cloneFull.StartsWith($handoffFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $handoffFull.StartsWith($cloneFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Clone path must be separate from the source worktree and handoff.'
}
git clone --no-checkout --no-tags $ExpectedRepository $Clone
if ($LASTEXITCODE -ne 0) { throw 'Clone creation failed; preserve it and inspect before retrying.' }
$existingBranchHead = (& git -C $Clone rev-parse --verify "refs/heads/$ExpectedBranch" 2>$null)
if ($LASTEXITCODE -eq 0) {
  if ($existingBranchHead.Trim() -cne $ExpectedBase) {
    throw 'Expected branch already exists at a different commit in the new clone; preserve it and stop.'
  }
  git -C $Clone switch $ExpectedBranch
  if ($LASTEXITCODE -ne 0) { throw 'Could not select the expected base branch; preserve the clone and inspect.' }
} else {
  git -C $Clone switch --detach $ExpectedBase
  if ($LASTEXITCODE -ne 0) { throw 'Expected base commit is not available from the confirmed repository; preserve the clone and stop.' }
  git -C $Clone switch --create $ExpectedBranch
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local base branch; preserve the clone and inspect.' }
}
$cloneHead = (git -C $Clone rev-parse HEAD).Trim()
$cloneBranch = (git -C $Clone branch --show-current).Trim()
$cloneRemote = (git -C $Clone remote get-url origin).Trim()
$cloneStatus = @(git --no-optional-locks -C $Clone status --porcelain=v1 --untracked-files=all)
if ($cloneHead -cne $ExpectedBase -or $cloneBranch -cne $ExpectedBranch -or
    $cloneRemote -cne $ExpectedRepository -or $cloneStatus.Count -ne 0) {
  throw 'New clone does not match the confirmed repository, branch, base, and clean-worktree requirements.'
}
'CLEAN CLONE VERIFIED; handoff not yet applied.'
```

Clone creation writes a new directory and Git metadata; it is not part of this review and must not be run without approval. The command does not overwrite an existing destination. If it fails after creating the directory, preserve and inspect it rather than deleting or retrying blindly.

### Separate-clone application — later approval required

Do not create a clone as part of this task. The following proposed application commands are for a later approved handoff only. Set `$Clone` to a separate, already-existing clone of the operator-confirmed repository/ref; the script refuses a base mismatch, dirty clone, hash mismatch, patch conflict, unsafe relative path, or destination collision.

```powershell
$ErrorActionPreference = 'Stop'
$Handoff = 'C:\Users\tp\Desktop\PartswalaIND-release-handoff-REPLACE-WITH-UNIQUE-ID'
$Clone = 'C:\Users\tp\Desktop\partswala-release-clone-REPLACE-WITH-APPROVED-PATH'
$ExpectedBase = 'c7e889f87860b261d99aeb3e556829d71acc90ce'
$ExpectedRepository = 'https://github.com/harshgamerz976-alt/partswala-ind.git'
$ExpectedBranch = 'release/partswala-launch-20261021'
$ExpectedManifestSha256 = 'PASTE-RECORDED-MANIFEST-SHA256'
$manifestPath = Join-Path $Handoff 'manifest.json'
if ($Handoff -match 'REPLACE-WITH|<|>' -or $Clone -match 'REPLACE-WITH|<|>' -or
    $ExpectedManifestSha256 -eq 'PASTE-RECORDED-MANIFEST-SHA256' -or
    $ExpectedManifestSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
    -not [IO.Path]::IsPathRooted($Handoff) -or -not [IO.Path]::IsPathRooted($Clone)) {
  throw 'Replace every placeholder and provide absolute, operator-approved paths and hashes.'
}
function Assert-NoReparsePath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $current = $root
  $relative = $fullPath.Substring($root.Length)
  foreach ($part in ($relative -split '[\\/]' | Where-Object { $_ })) {
    $current = Join-Path $current $part
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing reparse point in path: $current"
      }
    } else {
      break
    }
  }
}
function Assert-SafeRelativePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or
      $Path -match '[\x00-\x1f\t"<>:|?*]' -or $Path.Contains('\')) {
    throw "Unsafe repository-relative path: $Path"
  }
  if ($Path -match '(^|/)(?:\.git|node_modules|dist)(/|$)|(^|/)firestore-debug\.log$') {
    throw "Repository-relative path is excluded from the handoff: $Path"
  }
  foreach ($part in $Path.Split('/')) {
    if (-not $part -or $part -in @('.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or
        $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$') {
      throw "Unsafe repository-relative path component: $Path"
    }
  }
}
function Assert-UniqueRelativePaths([string[]]$Paths) {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($path in $Paths) {
    Assert-SafeRelativePath $path
    if (-not $seen.Add($path)) { throw "Case-insensitive path collision: $path" }
  }
}
function Assert-CredentialFreeRepositoryUrl([string]$Url) {
  $uri = $null
  $isAbsoluteUri = [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)
  $credentialedSshUser = $isAbsoluteUri -and $uri.Scheme -in @('ssh', 'git+ssh') -and $uri.UserInfo -ceq 'git'
  if ($isAbsoluteUri -and
      (($uri.UserInfo -and -not $credentialedSshUser) -or $uri.Query -or $uri.Fragment)) {
    throw 'Repository URL must not contain credentials, query parameters, or fragments.'
  }
  if ($Url.Contains('?') -or $Url.Contains('#') -or $Url -match '^[^/]+:[^/]+@[^:]+:') {
    throw 'Repository URL appears to contain embedded credentials.'
  }
  if ($Url -match '^([^/]+)@[^:]+:' -and $Matches[1] -cne 'git') {
    throw 'Use the standard credential-free git SSH username or a credential-free HTTPS repository URL.'
  }
}
function Assert-WithinRoot([string]$Path, [string]$Root) {
  $pathFull = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $pathFull.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved path is outside approved root: $pathFull"
  }
}
Assert-NoReparsePath $Handoff
Assert-NoReparsePath $Clone
Assert-NoReparsePath (Split-Path -Parent $Clone)
if (-not (Test-Path -LiteralPath $Handoff -PathType Container)) { throw 'Handoff directory is missing.' }
if (-not (Test-Path -LiteralPath $Clone -PathType Container)) { throw 'Approved clean clone does not exist.' }
$handoffParent = Split-Path -Parent $Handoff
$cloneParent = Split-Path -Parent $Clone
if (-not (Test-Path -LiteralPath $handoffParent -PathType Container) -or
    -not (Test-Path -LiteralPath $cloneParent -PathType Container)) {
  throw 'Handoff and clone parent directories must exist.'
}
Assert-NoReparsePath $manifestPath
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedManifestSha256.ToLowerInvariant()) {
  throw 'Manifest SHA-256 does not match the independently recorded value.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$patch = Join-Path $Handoff 'candidate-tracked.patch'
$untrackedRoot = Join-Path $Handoff 'untracked'
$trackedListPath = Join-Path $Handoff 'tracked-change-paths.txt'
$untrackedListPath = Join-Path $Handoff 'untracked-paths.txt'
$trackedTreePath = Join-Path $Handoff 'tracked-tree.txt'
Assert-NoReparsePath $patch
Assert-NoReparsePath $trackedListPath
Assert-NoReparsePath $untrackedListPath
Assert-NoReparsePath $trackedTreePath
Assert-NoReparsePath $untrackedRoot

$handoffFull = [IO.Path]::GetFullPath($Handoff).TrimEnd('\')
$cloneFull = [IO.Path]::GetFullPath($Clone).TrimEnd('\')
$sourceFull = 'C:\Users\tp\Desktop\Partswala IND\partswala-launch-release'.TrimEnd('\')
Assert-NoReparsePath $sourceFull
$cloneTopLevel = (& git -C $Clone rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $cloneTopLevel -or
    [IO.Path]::GetFullPath($cloneTopLevel).TrimEnd('\') -ine $cloneFull) {
  throw 'Clone path must be the repository top-level directory, not a subdirectory.'
}
$sourceTopLevel = (& git -C $sourceFull rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceTopLevel -or
    [IO.Path]::GetFullPath($sourceTopLevel).TrimEnd('\') -ine $sourceFull) {
  throw 'Configured source path is not the repository top-level directory.'
}
Assert-NoReparsePath (Split-Path -Parent $handoffFull)
Assert-NoReparsePath (Split-Path -Parent $cloneFull)
if ($cloneFull -eq $handoffFull -or
    $cloneFull.StartsWith($handoffFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $handoffFull.StartsWith($cloneFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Clone and handoff directories must be separate.'
}
if ($handoffFull -eq $sourceFull -or $handoffFull.StartsWith($sourceFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $sourceFull.StartsWith($handoffFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Handoff and source worktree must be separate.'
}
if ($cloneFull -eq $sourceFull -or $cloneFull.StartsWith($sourceFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $sourceFull.StartsWith($cloneFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Clone and source worktree must be separate.'
}
$cloneRemote = (& git -C $Clone remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $cloneRemote -cne $ExpectedRepository) {
  throw 'Clone origin does not match the operator-confirmed repository URL.'
}
$cloneHead = (& git -C $Clone rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $cloneHead -cne $manifest.baseHead) { throw "Clone base mismatch: $cloneHead" }
$cloneBranch = (& git -C $Clone branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $cloneBranch -cne $ExpectedBranch -or $manifest.branch -cne $ExpectedBranch) {
  throw "Clone/source branch mismatch: $cloneBranch"
}
if ($manifest.repositoryUrl -cne $ExpectedRepository) { throw 'Manifest repository URL does not match the operator-confirmed repository.' }
Assert-CredentialFreeRepositoryUrl $manifest.repositoryUrl
Assert-CredentialFreeRepositoryUrl $ExpectedRepository
$cloneStatus = @(& git --no-optional-locks -C $Clone status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $cloneStatus.Count -ne 0) { throw 'Clone must be clean before applying the handoff.' }
if (Test-Path -LiteralPath (Join-Path $Clone '.git') -PathType Container) {
  Assert-NoReparsePath (Join-Path $Clone '.git')
} else {
  throw 'Application requires a standard clone with a .git directory (not a linked worktree).'
}
$ignoredCloneStatus = @(& git --no-optional-locks -C $Clone status --porcelain=v1 --ignored=matching)
if ($LASTEXITCODE -ne 0 -or $ignoredCloneStatus.Count -ne 0) {
  throw 'Clean clone must not contain ignored or generated files before application.'
}
if ((Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.patchSha256) {
  throw 'Tracked patch hash mismatch.'
}
if ((Get-FileHash -LiteralPath $trackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.trackedPathListSha256) {
  throw 'Tracked path list hash mismatch.'
}
if ((Get-FileHash -LiteralPath $untrackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.untrackedPathListSha256) {
  throw 'Untracked path list hash mismatch.'
}
if ((Get-FileHash -LiteralPath $trackedTreePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.trackedTreeSha256) {
  throw 'Complete tracked-tree inventory hash mismatch.'
}
if ($manifest.patchSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.trackedPathListSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.untrackedPathListSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.trackedTreeSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.trackedTreeId -notmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$' -or
    $ExpectedBase -notmatch '^[0-9a-f]{40,64}$' -or
    $manifest.baseHead -cne $ExpectedBase) {
  throw 'Manifest schema, content hashes, or base revision are invalid.'
}

$manifestUntracked = @($manifest.entries | Where-Object kind -eq 'untracked' | ForEach-Object path | Sort-Object)
if (($manifestUntracked -join "`n") -cne (@($manifest.untrackedPaths | Sort-Object) -join "`n")) { throw 'Untracked manifest entries do not match the path inventory.' }
$manifestTracked = @($manifest.entries | Where-Object kind -eq 'tracked-change' | ForEach-Object path | Sort-Object)
if (($manifestTracked -join "`n") -cne (@($manifest.trackedChangePaths | Sort-Object) -join "`n")) {
  throw 'Tracked manifest entries do not match the path inventory.'
}
if (@($manifest.entries).Count -ne (@($manifest.trackedChangePaths).Count + @($manifest.untrackedPaths).Count)) {
  throw 'Manifest contains missing or unexpected file entries.'
}
Assert-UniqueRelativePaths @($manifest.trackedChangePaths)
Assert-UniqueRelativePaths @($manifest.untrackedPaths)
if (@($manifest.trackedFingerprint).Count -ne @($manifest.fingerprintBefore | Where-Object { $_.StartsWith("tracked`t", [StringComparison]::Ordinal) }).Count) {
  throw 'Complete tracked-file fingerprint is missing or incomplete.'
}
$fingerprintTracked = @($manifest.fingerprintBefore | Where-Object { $_.StartsWith("tracked`t", [StringComparison]::Ordinal) } | Sort-Object)
if (($fingerprintTracked -join "`n") -cne (@($manifest.trackedFingerprint | Sort-Object) -join "`n")) {
  throw 'Complete tracked-file fingerprint does not match the manifest.'
}
$fingerprintUntracked = @($manifest.fingerprintBefore | Where-Object { $_.StartsWith("untracked`t", [StringComparison]::Ordinal) } | Sort-Object)
$entryUntrackedFingerprint = @(
  $manifest.entries | Where-Object kind -eq 'untracked' |
    ForEach-Object { "untracked`t$($_.path)`t$($_.sourceSha256)" } | Sort-Object
)
if (($fingerprintUntracked -join "`n") -cne ($entryUntrackedFingerprint -join "`n") -or
    @($manifest.fingerprintBefore).Count -ne (@($manifest.trackedFingerprint).Count + @($fingerprintUntracked).Count)) {
  throw 'Source fingerprint contains missing, unexpected, or inconsistent file entries.'
}
$expectedTrackedPaths = [Collections.Generic.List[string]]::new()
foreach ($fingerprintRow in $manifest.trackedFingerprint) {
  $fields = $fingerprintRow -split "`t", 3
  if ($fields.Count -ne 3 -or $fields[0] -cne 'tracked' -or
      ($fields[2] -cne 'MISSING' -and $fields[2] -notmatch '^[0-9a-f]{64}$')) {
    throw 'Malformed tracked-file fingerprint in manifest.'
  }
  Assert-SafeRelativePath $fields[1]
  if ($fields[2] -cne 'MISSING') { $expectedTrackedPaths.Add($fields[1]) }
}
Assert-UniqueRelativePaths @($manifest.trackedFingerprint | ForEach-Object { ($_ -split "`t", 3)[1] })
$trackedFingerprintByPath = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($fingerprintRow in $manifest.trackedFingerprint) {
  $fields = $fingerprintRow -split "`t", 3
  if ($fields.Count -ne 3 -or $fields[0] -cne 'tracked') { throw 'Malformed tracked-file fingerprint in manifest.' }
  $trackedFingerprintByPath.Add($fields[1], $fields[2])
}
foreach ($entry in $manifest.entries | Where-Object kind -eq 'tracked-change') {
  if (-not $trackedFingerprintByPath.ContainsKey($entry.path)) {
    throw "Tracked change is missing from the complete source fingerprint: $($entry.path)"
  }
  $fingerprintHash = $trackedFingerprintByPath[$entry.path]
  if (($null -eq $entry.sourceSha256 -and $fingerprintHash -cne 'MISSING') -or
      ($null -ne $entry.sourceSha256 -and $entry.sourceSha256 -cne $fingerprintHash)) {
    throw "Tracked change hash does not match the complete source fingerprint: $($entry.path)"
  }
}
$treePaths = [Collections.Generic.List[string]]::new()
foreach ($treeLine in $manifest.trackedInventory) {
  if ($treeLine -notmatch '^100(?:644|755) blob (?:[0-9a-f]{40}|[0-9a-f]{64})\t(.+)$') {
    throw "Invalid complete tracked-tree record: $treeLine"
  }
  Assert-SafeRelativePath $Matches[1]
  $treePaths.Add($Matches[1])
}
Assert-UniqueRelativePaths @($treePaths)
if ((@($treePaths | Sort-Object) -join "`n") -cne (@($expectedTrackedPaths | Sort-Object) -join "`n")) {
  throw 'Tracked-tree path inventory differs from the complete source fingerprint.'
}
for ($left = 0; $left -lt $manifest.untrackedPaths.Count; $left++) {
  for ($right = $left + 1; $right -lt $manifest.untrackedPaths.Count; $right++) {
    $a = $manifest.untrackedPaths[$left].Replace('/', '\')
    $b = $manifest.untrackedPaths[$right].Replace('/', '\')
    if ($a.StartsWith($b + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $b.StartsWith($a + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Untracked file/directory path collision: $a and $b"
    }
  }
}
$expectedHandoffFiles = @(
  'candidate-tracked.patch',
  'tracked-change-paths.txt',
  'untracked-paths.txt',
  'tracked-tree.txt',
  'manifest.json'
) + @($manifest.untrackedPaths | ForEach-Object { "untracked/$_" })
$actualHandoffFiles = @(
  Get-ChildItem -LiteralPath $Handoff -Force -Recurse |
    ForEach-Object {
      if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point found in handoff: $($_.FullName)" }
      if (-not $_.PSIsContainer) { [IO.Path]::GetRelativePath($Handoff, $_.FullName).Replace('\', '/') }
    } | Sort-Object
)
if (($actualHandoffFiles -join "`n") -cne (@($expectedHandoffFiles | Sort-Object) -join "`n")) {
  throw 'Handoff contains missing or unexpected files.'
}
if ((@((Get-Content -LiteralPath $trackedListPath) | Sort-Object) -join "`n") -cne (@($manifest.trackedChangePaths | Sort-Object) -join "`n")) {
  throw 'Tracked path-list contents do not match the manifest.'
}
if ((@((Get-Content -LiteralPath $untrackedListPath) | Sort-Object) -join "`n") -cne (@($manifest.untrackedPaths | Sort-Object) -join "`n")) {
  throw 'Untracked path-list contents do not match the manifest.'
}
if ((@((Get-Content -LiteralPath $trackedTreePath) | Sort-Object) -join "`n") -cne (@($manifest.trackedInventory | Sort-Object) -join "`n")) {
  throw 'Tracked-tree inventory contents do not match the manifest.'
}
$handoffLocks = [Collections.Generic.List[IO.FileStream]]::new()
try {
foreach ($relativePath in $actualHandoffFiles) {
  $handoffPath = Join-Path $Handoff $relativePath
  Assert-WithinRoot $handoffPath $handoffFull
  Assert-NoReparsePath $handoffPath
  $handoffLocks.Add([IO.File]::Open($handoffPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read))
}
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedManifestSha256.ToLowerInvariant() -or
    (Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.patchSha256 -or
    (Get-FileHash -LiteralPath $trackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.trackedPathListSha256 -or
    (Get-FileHash -LiteralPath $untrackedListPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.untrackedPathListSha256 -or
    (Get-FileHash -LiteralPath $trackedTreePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.trackedTreeSha256) {
  throw 'A locked handoff file hash changed after initial validation.'
}
foreach ($entry in $manifest.entries | Where-Object kind -eq 'untracked') {
  $lockedUntrackedPath = Join-Path $untrackedRoot $entry.path
  if ((Get-FileHash -LiteralPath $lockedUntrackedPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sourceSha256) {
    throw "Locked untracked-file hash changed after initial validation: $($entry.path)"
  }
}
$lockedHandoffFiles = @(
  Get-ChildItem -LiteralPath $Handoff -Force -Recurse |
    ForEach-Object {
      if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point found in locked handoff: $($_.FullName)" }
      if (-not $_.PSIsContainer) { [IO.Path]::GetRelativePath($Handoff, $_.FullName).Replace('\', '/') }
    } | Sort-Object
)
if (($lockedHandoffFiles -join "`n") -cne (@($expectedHandoffFiles | Sort-Object) -join "`n")) {
  throw 'Locked handoff inventory contains missing or unexpected files.'
}
foreach ($entry in $manifest.entries) {
  Assert-SafeRelativePath $entry.path
  if ($entry.kind -eq 'untracked') {
    if ($entry.sourceSha256 -notmatch '^[0-9a-f]{64}$' -or
        $entry.handoffSha256 -notmatch '^[0-9a-f]{64}$' -or
        $entry.sourceSha256 -cne $entry.handoffSha256) {
      throw "Invalid or inconsistent untracked-file hashes in manifest: $($entry.path)"
    }
    $sourceCopy = Join-Path $untrackedRoot $entry.path
    $clonePath = Join-Path $Clone $entry.path
    Assert-WithinRoot $sourceCopy $untrackedRoot
    Assert-WithinRoot $clonePath $cloneFull
    Assert-NoReparsePath $sourceCopy
    Assert-NoReparsePath (Split-Path -Parent $clonePath)
    if (Test-Path -LiteralPath $clonePath) { throw "Clone destination already exists: $($entry.path)" }
    $parentPath = Split-Path -Parent $clonePath
    while ($parentPath -and $parentPath.StartsWith($cloneFull, [StringComparison]::OrdinalIgnoreCase)) {
      if ((Test-Path -LiteralPath $parentPath) -and -not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        throw "Clone parent path is not a directory: $parentPath"
      }
      if ($parentPath -eq $cloneFull) { break }
      $parentPath = Split-Path -Parent $parentPath
    }
    $sourceHash = (Get-FileHash -LiteralPath $sourceCopy -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -cne $entry.sourceSha256 -or $sourceHash -cne $entry.handoffSha256) {
      throw "Handoff file hash mismatch: $($entry.path)"
    }
  } elseif ($entry.kind -eq 'tracked-change') {
    if ($null -ne $entry.sourceSha256 -and $entry.sourceSha256 -notmatch '^[0-9a-f]{64}$') {
      throw "Invalid tracked-file hash in manifest: $($entry.path)"
    }
  } else {
    throw "Unknown manifest entry kind: $($entry.kind)"
  }
}

& git -C $Clone apply --check --binary $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch check failed; clone was not changed.' }

$verifyRoot = Join-Path ([IO.Path]::GetTempPath()) ("partswala-handoff-verify-" + [guid]::NewGuid().ToString('N'))
$tempRootFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$verifyRoot = [IO.Path]::GetFullPath($verifyRoot).TrimEnd('\')
if (Test-Path -LiteralPath $verifyRoot) { throw 'Temporary preflight directory already exists.' }
if (-not $verifyRoot.StartsWith($tempRootFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temporary preflight directory is outside its approved system-temp root.'
}
foreach ($protectedRoot in @($cloneFull, $handoffFull, $sourceFull)) {
  if ($verifyRoot -eq $protectedRoot -or
      $verifyRoot.StartsWith($protectedRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $protectedRoot.StartsWith($verifyRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Temporary preflight directory overlaps the source, handoff, or clone.'
  }
}
$preflightIndex = Join-Path $verifyRoot 'index'
$preflightObjects = Join-Path $verifyRoot 'objects'
$cloneObjects = Join-Path (Join-Path $Clone '.git') 'objects'
$previousIndex = $env:GIT_INDEX_FILE
$previousObjectDirectory = $env:GIT_OBJECT_DIRECTORY
$previousAlternates = $env:GIT_ALTERNATE_OBJECT_DIRECTORIES
try {
  New-Item -ItemType Directory -Path $preflightObjects -Force | Out-Null
  Assert-NoReparsePath $verifyRoot
  Assert-NoReparsePath $preflightObjects
  Assert-WithinRoot $preflightIndex $verifyRoot
  Assert-WithinRoot $preflightObjects $verifyRoot
  $env:GIT_INDEX_FILE = $preflightIndex
  $env:GIT_OBJECT_DIRECTORY = $preflightObjects
  $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $cloneObjects
  & git -C $Clone read-tree $cloneHead
  if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the temporary handoff preflight index.' }
  & git -C $Clone apply --cached --binary $patch
  if ($LASTEXITCODE -ne 0) { throw 'Patch cannot be applied to the temporary preflight index.' }
  $preflightPaths = @(& git -C $Clone diff --cached --no-renames --name-only $cloneHead | Sort-Object)
  if ($LASTEXITCODE -ne 0 -or
      ($preflightPaths -join "`n") -cne (@($manifest.trackedChangePaths | Sort-Object) -join "`n")) {
    throw 'Patch paths differ from the manifest before clone modification.'
  }
  $preflightTree = (& git -C $Clone write-tree).Trim()
  if ($LASTEXITCODE -ne 0 -or $preflightTree -cne $manifest.trackedTreeId) {
    throw 'Patch does not produce the manifest tracked tree; clone was not changed.'
  }
  Write-Output "PREFLIGHT VERIFIED: tracked patch produces manifest tree $preflightTree."
} finally {
  $env:GIT_INDEX_FILE = $previousIndex
  $env:GIT_OBJECT_DIRECTORY = $previousObjectDirectory
  $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $previousAlternates
  if (Test-Path -LiteralPath $verifyRoot) {
    Remove-Item -LiteralPath $verifyRoot -Recurse -Force
  }
}

$applicationStarted = $false
try {
  $applicationStarted = $true
  Write-Output "APPLICATION STARTED: $cloneFull"
  & git -C $Clone apply --binary $patch
  if ($LASTEXITCODE -ne 0) { throw 'Patch application failed; clone may be partially modified.' }

  foreach ($entry in $manifest.entries | Where-Object kind -eq 'untracked') {
    $sourceCopy = Join-Path $untrackedRoot $entry.path
    $clonePath = Join-Path $Clone $entry.path
    Assert-WithinRoot $sourceCopy $untrackedRoot
    Assert-WithinRoot $clonePath $cloneFull
    $parent = Split-Path -Parent $clonePath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Assert-NoReparsePath $parent
    if (Test-Path -LiteralPath $clonePath) { throw "Clone destination appeared during application: $($entry.path)" }
    Copy-Item -LiteralPath $sourceCopy -Destination $clonePath
    Assert-NoReparsePath $clonePath
    Assert-WithinRoot $clonePath $cloneFull
    $copiedHash = (Get-FileHash -LiteralPath $clonePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($copiedHash -cne $entry.sourceSha256) { throw "Clone copy hash mismatch: $($entry.path)" }
  }

  $actualTracked = @(& git -C $Clone diff --no-renames --name-only HEAD | Sort-Object)
  if ($LASTEXITCODE -ne 0 -or ($actualTracked -join "`n") -cne (@($manifest.trackedChangePaths | Sort-Object) -join "`n")) {
    throw 'Clone tracked-change paths do not match the manifest.'
  }
  foreach ($entry in $manifest.entries | Where-Object kind -eq 'tracked-change') {
    $clonePath = Join-Path $Clone $entry.path
    Assert-WithinRoot $clonePath $cloneFull
    Assert-NoReparsePath $clonePath
    if ($null -eq $entry.sourceSha256) {
      if (Test-Path -LiteralPath $clonePath) { throw "Expected deleted tracked file still exists: $($entry.path)" }
    } else {
      if (-not (Test-Path -LiteralPath $clonePath -PathType Leaf)) { throw "Tracked file missing in clone: $($entry.path)" }
      $cloneHash = (Get-FileHash -LiteralPath $clonePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($cloneHash -cne $entry.sourceSha256) { throw "Tracked file hash mismatch: $($entry.path)" }
    }
  }
  foreach ($fingerprintRow in $manifest.trackedFingerprint) {
    $fields = $fingerprintRow -split "`t", 3
    if ($fields.Count -ne 3 -or $fields[0] -cne 'tracked') { throw 'Malformed tracked-file fingerprint in manifest.' }
    $relativePath = $fields[1]
    $expectedHash = $fields[2]
    Assert-SafeRelativePath $relativePath
    $clonePath = Join-Path $Clone $relativePath
    Assert-WithinRoot $clonePath $cloneFull
    Assert-NoReparsePath $clonePath
    if ($expectedHash -ceq 'MISSING') {
      if (Test-Path -LiteralPath $clonePath) { throw "Deleted tracked path unexpectedly exists in clone: $relativePath" }
    } else {
      if ($expectedHash -notmatch '^[0-9a-f]{64}$' -or
          -not (Test-Path -LiteralPath $clonePath -PathType Leaf)) {
        throw "Tracked source file is missing or its manifest hash is invalid: $relativePath"
      }
      $actualHash = (Get-FileHash -LiteralPath $clonePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -cne $expectedHash) { throw "Complete tracked-file SHA-256 mismatch: $relativePath" }
    }
  }

  $previousIndex = $env:GIT_INDEX_FILE
  $verifyIndex = Join-Path (Join-Path $Clone '.git') ("handoff-verify-" + [guid]::NewGuid().ToString('N') + '.index')
  if (Test-Path -LiteralPath $verifyIndex) { throw 'Temporary verification index path already exists.' }
  try {
    $env:GIT_INDEX_FILE = $verifyIndex
    & git -C $Clone read-tree $cloneHead
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the clone verification index.' }
    & git -C $Clone add -A -- .
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the complete clone tracked tree.' }
    foreach ($relativePath in $manifest.untrackedPaths) {
      & git -C $Clone rm --cached --ignore-unmatch -- $relativePath
      if ($LASTEXITCODE -ne 0) { throw "Could not exclude copied untracked file from tracked-tree verification: $relativePath" }
    }
    $cloneTree = (& git -C $Clone write-tree).Trim()
    if ($LASTEXITCODE -ne 0 -or $cloneTree -cne $manifest.trackedTreeId) {
      throw 'Clone tracked tree differs from the captured tree; paths, contents, or modes do not match.'
    }
  } finally {
    $env:GIT_INDEX_FILE = $previousIndex
    if (Test-Path -LiteralPath $verifyIndex -PathType Leaf) {
      Remove-Item -LiteralPath $verifyIndex
    }
  }

  $expectedUntracked = @($manifest.untrackedPaths | Sort-Object)
  $actualUntracked = @(& git -C $Clone ls-files --others --exclude-standard | Sort-Object)
  if ($LASTEXITCODE -ne 0 -or ($actualUntracked -join "`n") -cne ($expectedUntracked -join "`n")) {
    throw 'Clone complete non-ignored untracked-file inventory does not match the manifest.'
  }
  foreach ($relativePath in $actualUntracked) {
    $clonePath = Join-Path $Clone $relativePath
    Assert-WithinRoot $clonePath $cloneFull
    Assert-NoReparsePath $clonePath
    $expectedEntry = @($manifest.entries | Where-Object { $_.kind -eq 'untracked' -and $_.path -ceq $relativePath })
    if ($expectedEntry.Count -ne 1) { throw "Unexpected or duplicated clone untracked path: $relativePath" }
    if ((Get-FileHash -LiteralPath $clonePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedEntry[0].sourceSha256) {
      throw "Final clone untracked-file hash mismatch: $relativePath"
    }
  }
  Write-Output 'APPLICATION VERIFIED: clone contents match the handoff manifest.'
  Write-Output "Verified base=$cloneHead branch=$cloneBranch repository=operator-confirmed trackedTree=$cloneTree"
  Write-Output "Verified tracked changes=$($manifest.trackedChangePaths.Count) untracked files=$($manifest.untrackedPaths.Count)"
} catch {
  if ($applicationStarted) {
    Write-Output "APPLICATION INCOMPLETE: clone may be partially modified; do not reset or delete it. Inspect and preserve it: $cloneFull"
    $failureStatus = @(& git --no-optional-locks -C $Clone status --short --untracked-files=all)
    if ($LASTEXITCODE -eq 0) { $failureStatus }
  }
  throw
}
} finally {
  foreach ($handoffLock in $handoffLocks) { $handoffLock.Dispose() }
}
'HANDOFF VERIFIED; RELEASE CANDIDATE NOT VERIFIED. Do not stage, commit, push, or deploy without separate approval.'
```

## Final handoff preflight checklist

- [ ] Confirm the source path, branch, exact `HEAD`, tracked/untracked inventory, and expected base before capture. The candidate must remain quiescent; stop editors, builds, formatters, and sync clients that could write.
- [ ] Use a new unique handoff directory outside the source repository. The directory must not already exist. Its existing parent and all path components must not be symlinks or reparse points.
- [ ] Review exclusions (`.git`, `node_modules`, `backend/node_modules`, `dist`, `firestore-debug.log`) and make sure no required deliverable is being omitted.
- [ ] Run capture only after approval. Require the exact `HANDOFF VERIFIED` result and independently record the printed manifest SHA-256. Any thrown error, watcher event, path mismatch, changed fingerprint/status, or failed tree/patch comparison means **not verified**; preserve the partial handoff for inspection.
- [ ] Before application, independently confirm repository URL, clone base commit, clean status, and that clone, handoff, and source paths are separate and have no symlink/reparse components. Confirm every intended untracked destination is absent.
- [ ] Apply only to the approved clean clone. Require `APPLICATION VERIFIED`, matching tracked paths/hashes, and an exact complete non-ignored untracked-file inventory. If output says `APPLICATION INCOMPLETE` or any command fails after `APPLICATION STARTED`, preserve the clone and inspect it; never automatically reset or delete it.
- [ ] Stop before staging, committing, pushing, deploying, publishing Firebase rules, changing DNS/production settings, or modifying production data. Each requires separate explicit authorization; this handoff procedure grants none of it.
- [ ] Treat these outcomes separately: **HANDOFF VERIFIED** means the captured patch/files match the recorded source state; it does not mean tests passed or the code is approved. **RELEASE CANDIDATE VERIFIED** requires separate code review, required tests/builds, release-target confirmation, and explicit release-owner approval. These scripts never declare a release candidate verified.

## Handoff procedure limitations

- The capture uses temporary Git indexes and an isolated temporary Git object directory (with the source object database read only as an alternate) to build a tree from the tracked source working tree (`git add -A`, then removes the separately inventoried untracked paths from that temporary index) and another from the binary patch applied to the expected base. It must not write new Git objects into the source object database or change the real index. Equal tree IDs verify the patch reproduces tracked contents, additions, deletions, and Git-recorded regular-file modes, including binary blobs, subject to Git's configured clean filters. Symlinks, submodules, and non-regular tracked entries are rejected. Temporary indexes are removed after comparison; if interrupted, the new handoff may contain temporary index files and the system temp directory may contain verification objects.
- SHA-256 detects content changes relative to the captured manifest; it does not authenticate the handoff unless the manifest hash is recorded through an independent trusted channel. Git path inventories contain repository-relative paths. Untracked inventories include non-ignored files only; generated/ignored exclusions are intentionally not captured.
- The application checks lexical canonical paths, rejects rooted/traversal/alternate-stream paths and reparse points, and checks destination containment before and after copy. These checks cannot eliminate a race where another process swaps filesystem components after a check. They are not a substitute for OS-level isolation or running in a trusted, quiescent environment.
- Application locks the enumerated handoff files against writes/deletes while applying, but does not lock the handoff directory itself. A concurrent new-file race remains possible; the complete inventory is rechecked under file locks, and any discrepancy must stop the procedure.
- Read-only sharing locks cover existing source files, not the repository directory. The watcher can overflow, and unusual filesystem drivers, external writers, or filesystem event timing can limit detection. Any lock failure, watcher error, event, or hash/status/tree mismatch is a hard stop. Recheck the source immediately before and after capture.
- Application is deliberately non-transactional. `git apply` and file copies may leave some tracked or untracked changes in the clone if a later operation fails. The script reports `APPLICATION INCOMPLETE` and the clone status; preserve that clone for investigation. It never resets or deletes the clone, and a failed run must not be retried on the same clone without an explicit recovery decision.
- The handoff and clone procedures have not been executed or runtime-tested. A clean hash/inventory result alone does not establish build correctness, security, production configuration, deployment readiness, or launch approval.

The capture script writes only to a new handoff directory plus one new system-temp verification directory and never deletes partial handoff output. It removes its two specifically named temporary verification indexes and temporary object directory after tree comparison, and removes `verify-current.patch` after final checks; if interrupted or failed before cleanup, temporary files may remain. The application preflight writes a unique temporary index/object directory under the system temp path and removes only that exact generated directory in `finally`; an interruption may leave it behind. No command deletes source files or automatically resets/deletes the clone. The application writes the patch and untracked files only into the approved clone after preflight; patch contents may include tracked deletions. Run only with explicit approval and a quiescent source.

The scripts expect ordinary Git path names representable as one line of PowerShell text. Paths containing control characters, tabs, quotes, alternate-stream syntax, or other rejected Windows components fail closed; they are not silently omitted. Git submodules, tracked symlinks, and non-regular tree entries are unsupported. The clone-creation command is also untested and may leave a partial new clone if interrupted.

## Post-deployment verification checklist — only after explicit approval

Use the approved deployment host and test identities. Do not print ID tokens, passwords, private keys, payment credentials, or customer data. Record status codes and sanitized response fields only.

### Public settings schema

Request `GET https://partswala-ind.onrender.com/api/settings/public`. Verify:

- HTTP 200 and `Cache-Control: no-store`.
- `GET /health` returns HTTP 200 with the expected healthy backend status.
- `preLaunchEnabled` is boolean.
- `launchTime` is exactly `2026-11-07T18:30:00.000Z`.
- `serverTimeUtc` is a canonical UTC ISO timestamp representing the backend's sampled clock.
- `millisecondsUntilLaunch` is a non-negative integer exactly equal to `max(0, launchTime - serverTimeUtc)`.
- `preLaunchEnabled` is true exactly when `serverTimeUtc` is earlier than the target.
- The response contains no private store/admin/payment configuration.

Missing, invalid, inconsistent, or unavailable status must leave ordinary visitors on Coming Soon and must not unlock API routes.

Example PowerShell check (run only after the approved backend release; prints no secrets):

```powershell
$ErrorActionPreference = 'Stop'
$api = 'https://partswala-ind.onrender.com'
$health = Invoke-WebRequest -Uri "$api/health" -TimeoutSec 120 -UseBasicParsing
$healthBody = $health.Content | ConvertFrom-Json
if ($health.StatusCode -ne 200 -or $healthBody.ok -ne $true -or
    $healthBody.service -cne 'partswala-ind-backend') {
  throw 'Backend health check did not return the expected healthy service.'
}
$response = Invoke-WebRequest -Uri "$api/api/settings/public" -TimeoutSec 120 -UseBasicParsing
$settings = $response.Content | ConvertFrom-Json
$targetMs = [DateTimeOffset]::Parse('2026-11-07T18:30:00.000Z').ToUnixTimeMilliseconds()
$serverUtc = [DateTimeOffset]::Parse($settings.serverTimeUtc).ToUniversalTime()
$serverMs = $serverUtc.ToUnixTimeMilliseconds()
$canonicalServerTime = $serverUtc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
$remainingMs = [Math]::Max([long]0, [long]($targetMs - $serverMs))
if ($response.Headers['Cache-Control'] -notmatch '(?i)\bno-store\b' -or
    $settings.preLaunchEnabled -isnot [bool] -or
    $settings.launchTime -cne '2026-11-07T18:30:00.000Z' -or
    $settings.serverTimeUtc -cne $canonicalServerTime -or
    ($settings.millisecondsUntilLaunch -isnot [int] -and $settings.millisecondsUntilLaunch -isnot [long]) -or
    [long]$settings.millisecondsUntilLaunch -ne $remainingMs -or
    $settings.preLaunchEnabled -ne ($serverMs -lt $targetMs)) {
  throw 'Public launch status schema or values are invalid.'
}
'Public launch status schema: PASS'
```

### Pre-launch API denial and side-effect checks

Before launch, test with no credentials and with an ordinary customer identity. Expect HTTP 403 (or the documented auth response where authentication occurs before the gate) for:

- `GET /api/public-products?limit=1`, `GET /api/public-products/{known-test-id}`, `POST /api/public-products/by-ids`, vendor contact/name lookup, and `GET /api/reviews?productId={known-test-id}`.
- `POST /api/reviews`, `POST /api/vendor/enquiries`, `POST /api/checkout/quote`, and `POST /api/orders`.
- `POST /api/phonepe/orders`, `POST /api/razorpay/orders`, and `POST /api/razorpay/verify`.
- Anonymous and ordinary-customer `POST /api/ai/chat` requests that attempt marketplace/product lookup.

Do not send mutating enquiry, review, checkout, order, or payment requests to production, even with synthetic or empty payloads: if the gate is absent, a request could write data, reserve inventory, or initiate a real payment. The side-effect assertions must run only with generated fixtures in the local demo emulator or a separately approved non-production staging environment. Test the production public gate with read-only requests; a frontend Coming Soon page is not evidence of backend enforcement.

After the settings check passes and confirms pre-launch status, these unauthenticated/public API probes should all return 403. The POST probes below perform read-only catalogue lookups; they must not create customer/order/payment records:

```powershell
$ErrorActionPreference = 'Stop'
$api = 'https://partswala-ind.onrender.com'
function Assert-Status([string]$Url, [int]$Expected, [string[]]$CurlArgs = @()) {
  $actual = & curl.exe @CurlArgs $Url
  if ($LASTEXITCODE -ne 0 -or $actual -ne [string]$Expected) {
    throw "Expected HTTP $Expected from $Url; got HTTP $actual."
  }
  "HTTP $actual $Url"
}
$statusArgs = @('--silent', '--show-error', '--output', 'NUL', '--write-out', '%{http_code}')
Assert-Status "$api/api/public-products?limit=1" 403 $statusArgs
Assert-Status "$api/api/public-products/launch-gate-nonexistent" 403 $statusArgs
Assert-Status "$api/api/public-products/by-ids" 403 ($statusArgs + @('--header', 'Content-Type: application/json', '--data-raw', '{"productIds":["launch-gate-nonexistent"]}'))
Assert-Status "$api/api/products/launch-gate-nonexistent/vendor-contact" 403 $statusArgs
Assert-Status "$api/api/reviews?productId=launch-gate-nonexistent" 403 $statusArgs
Assert-Status "$api/api/products/vendor-names" 403 ($statusArgs + @('--header', 'Content-Type: application/json', '--data-raw', '{"productIds":["launch-gate-nonexistent"]}'))
$catalogueResponse = Invoke-WebRequest -Uri "$api/api/public-products?limit=1" -TimeoutSec 120 -UseBasicParsing -SkipHttpErrorCheck
if ($catalogueResponse.StatusCode -ne 403 -or
    $catalogueResponse.Headers['Cache-Control'] -notmatch '(?i)\bno-store\b') {
  throw 'Pre-launch catalogue denial or no-store response header is missing.'
}
```

These probes cover read-only endpoints only. Do not use the AI route as a production probe: if the gate is missing, it could call a paid provider. The AI denial and all protected mutations are covered by the local emulator test. Never use production as staging.

The emulator command below creates a unique temporary working directory outside the repository, copies only the reviewed `firestore.rules`, and runs all four emulator suites against an explicit `demo-*` project. This prevents Firebase from overwriting the existing repository `firestore-debug.log`. Do not reuse an existing path; after verifying the results, remove only the exact temporary directory created by that run.

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\tp\Desktop\Partswala IND\partswala-launch-release'
$emulatorRoot = Join-Path $env:TEMP ('partswala-launch-emulator-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $emulatorRoot) { throw 'Refusing to overwrite an existing emulator directory.' }
New-Item -ItemType Directory -Path $emulatorRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'firestore.rules') -Destination (Join-Path $emulatorRoot 'firestore.rules')
$config = @{
  firestore = @{ rules = 'firestore.rules' }
  emulators = @{
    auth = @{ host = '127.0.0.1'; port = 9099 }
    firestore = @{ host = '127.0.0.1'; port = 8080 }
    singleProjectMode = $true
  }
}
$config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $emulatorRoot 'firebase.json') -Encoding utf8
Push-Location $emulatorRoot
try {
  firebase emulators:exec --config (Join-Path $emulatorRoot 'firebase.json') --project demo-partswalaind --only auth,firestore `
    "node --test `"$repo\backend\firestoreLaunchGate.emulator.test.js`" `"$repo\backend\vendorEnquiries.emulator.test.js`" `"$repo\backend\vendorBulkImport.emulator.test.js`" `"$repo\backend\cloudinaryUploads.emulator.test.js`""
} finally {
  Pop-Location
}
```

The emulator tests use isolated generated accounts/products and verify a denied enquiry leaves no enquiry record and a denied order leaves no order record. Checkout/order/payment requests are rejected before payment processing. This does not publish rules or contact production. Never use production as staging. If a separate non-production staging environment is formally approved, use only its isolated test identities and test payment credentials; otherwise keep write-side-effect verification local to the emulator.

### Admin access and authorization

- Verify an actual approved admin can sign in through the admin login route before launch and access only authorized management features.
- Verify admin authentication does not grant anonymous/public catalogue API access unless that route's reviewed policy explicitly permits it; current candidate catalog APIs do not include an admin bypass.
- Verify an ordinary customer cannot access admin routes or data.
- Do not create or alter production admin claims/allowlists solely for testing. Use the organization's approved admin identity and access process.

### Firestore rules

- Review the exact rules diff and the three-email/custom-claim `isAdmin()` policy before publishing.
- In an isolated `demo-*` Auth/Firestore emulator, verify unauthenticated and ordinary-customer product reads are denied before launch and an emulator-only `admin: true` custom claim is allowed. Never point tests at a production project.
- For the post-launch boundary, use a supported, isolated Firebase test project/emulator procedure that can genuinely supply the target `request.time`. Do not modify request payloads to spoof `request.time`, alter production rules for testing, or claim post-launch rules passed based on source inspection. If no supported time-control method is available, mark post-launch rule access **NOT VERIFIED** and obtain an approved Firebase-specific verification method before release.
- If Firebase cannot provide a supported future-time emulator, and only after separate explicit approval at/after the actual launch instant, use a client SDK with no Admin SDK privileges to read one already-existing, designated, non-sensitive public product; verify an unauthenticated read succeeds, then verify an ordinary customer can read that same document and the approved admin can still read it. Do not create a test document, log/export document contents, or write production data. This verifies access after the boundary, not a simulated one-millisecond-before request; retain emulator denial/admin tests for the pre-launch case.
- Confirm production rules are the reviewed version through an authenticated, read-only Firebase Console or CLI check before testing. Do not publish rules without explicit authorization.
- Legal acceptance audit records are written only by the authenticated backend to `legalAcceptances`; local rules explicitly deny browser read/write. Owner must define lawful retention and any data-subject access/deletion process for these records before publication.

### Hosting and custom domain

- In Firebase Console, select project `partswalaflutter`, open **Hosting**, and inspect the site list. For each of `partswalaflutter` and `partswalaind`, open **Custom domains** and record the site ID, associated domains, verification state, and certificate state. Confirm explicitly whether `partswalaind.com` maps to the `partswalaind` site; do not infer this from `.firebaserc`, DNS, or `web.app` URLs.
- Compare `https://partswalaind.com/`, `https://partswalaflutter.web.app/`, and `https://partswalaind.web.app/` for the expected build's asset names and content. Verify direct URLs such as `/products` and `/products/{id}` return the intended SPA shell, then confirm API denial separately.
- Verify HTTPS certificate validity and Hosting response headers. Do not infer the correct deploy target solely from `.firebaserc` default project.

### Automatic unlock and post-launch behavior

- Keep the candidate backend clock synchronized through the host's supported time service; obtain host/platform evidence from the operator. Local response dates are not proof of Render's NTP status.
- Ensure the client refreshes authoritative status on its fixed 30-second poll and remains closed if refresh fails. No countdown is implemented. Verify a page opened before launch transitions after the server reaches the target without manual refresh/redeployment.
- At/after launch, use read-only production checks for public catalogue listing/detail and settings. Do not create production enquiries/orders/reviews or initiate payments as a smoke test. Verify checkout, order, enquiry, and payment mutations only in the local emulator or an explicitly approved non-production staging environment with test payment credentials. Verify authorized admin/vendor management using the approved operator workflow.
- Previously downloaded browser or Firestore-persisted data cannot necessarily be erased remotely. Communicate this limitation; do not claim remote revocation of already cached data.

## November 7 final verification checkpoint

Perform these checks read-only until the release owner separately approves a release action:

1. Recheck branch, HEAD, full Git status, staged/unstaged diffs, and all untracked files. At the latest 2026-11-01 check there were 55 modified tracked paths, 47 untracked files, no staged files, and no tracked deletions; verify rather than assuming these counts are unchanged. The expected base must remain `c7e889f87860b261d99aeb3e556829d71acc90ce`; do not repair a mismatch.
2. Obtain an operator-approved capture destination and independently review the capture/application scripts. Do not run either script unless capture/application is separately approved. Capture alone is not release-candidate verification.
3. In Render Dashboard, record the exact service name/ID, repository URL, branch, root, build/start commands, health check, deployed commit, and auto-deploy setting. Confirm environment variable names are present without viewing values. Stop if the configured repository/branch/commit cannot be tied to the reviewed candidate.
4. In Firebase Console, record the Hosting site ID and custom-domain association for `partswalaind.com`. Stop if the mapping is ambiguous or if the deployed assets at the domain do not match the reviewed Hosting build.
5. After a separately approved deployment only, run the public settings schema command and read-only pre-launch GET/catalogue probes above. Record status codes and sanitized fields only. Require a valid settings response and HTTP 403 for every listed public catalogue read while `preLaunchEnabled` is true.
6. Confirm the local demo-emulator side-effect tests and Firestore/admin tests pass on the reviewed rules. The raw-product rule is time-independent; verify the deployed ruleset was reviewed/published through an approved release action, but do not perform a production read that exposes raw product data.
7. Verify the deployed catalogue returns `Cache-Control: no-store` and remains launch-gated. Verify the approved-vendor login and permitted dashboard journey against the intended pre-launch policy. Do not call the release ready while any remains unresolved.
8. Record verified facts, unresolved items, evidence, and the approving operator. Do not stage, commit, push, publish rules, deploy, change DNS/settings, or write production data without separate explicit approval.

## November 8 launch checkpoint

Only the authorized release operator may perform approved production steps. The candidate must already be deployed and verified; do not rely on a last-minute deployment to create the gate.

1. Before `2026-11-07T18:30:00.000Z`, verify public settings report the exact target and `preLaunchEnabled: true`, catalogue GET probes return 403, and ordinary visitors still see Coming Soon. Do not send production mutation or paid-AI probes.
2. Confirm admin login and authorized access through the approved identity. Confirm the vendor access policy chosen on November 6; do not expose vendor operations accidentally while adjusting the global gate.
3. At/after the target, poll the public settings endpoint until `serverTimeUtc >= 2026-11-07T18:30:00.000Z` and `preLaunchEnabled` is false. Then verify public catalogue GETs open and a page left open before launch transitions without refresh. If settings are invalid or stale, keep the launch blocked and escalate.
4. Verify Firestore product reads after the target only with the approved client-only, non-sensitive existing product procedure above. Do not use the Admin SDK for this check or write a production fixture.
5. Validate enquiry and quote mutations only in approved non-production fixtures with test credentials. Confirm signed payment/refund/shipping webhooks and commerce-state mutations return `503 COMMERCE_UNAVAILABLE` with no writes while the permanent lock is disabled; verify unrelated admin/vendor maintenance still works. Monitor errors and record evidence without storing tokens, customer data, or secrets.
6. Stop and escalate if API and UI status disagree, any pre-launch read exposed catalogue data, any intended authorization fails, or the Hosting custom domain serves an unreviewed build.

## Rollback and stop conditions

Keep the public launch blocked if the production settings schema is absent/inconsistent; any ordinary visitor receives catalogue data before launch; catalogue responses are not explicitly protected from HTTP caching; a denied mutation has side effects in the local/staging fixture; admin login/authorization fails; approved-vendor UI/API access is not verified in the deployed candidate; the custom-domain Hosting target is ambiguous; or the reviewed Firestore rule version cannot be confirmed. Escalate to the release owner for an approved backend/Firestore/Hosting correction or rollback. No rollback or production change is authorized by this runbook.

## November 7 final verification plan (not yet performed)

This is a checklist for the authorized operator on November 7, not evidence that these production checks have passed. Do not perform production verification early or with real customer/vendor data.

### Historical local validation — 2026-11-01 (superseded by the 2026-11-06 state above)

- Final revalidation: backend `npm test -- --test-concurrency=1` completed **253 tests: 249 passed, 0 failed, 4 skipped**; focused launch-gate suite completed **34 tests: 32 passed, 0 failed, 2 emulator-dependent skips**. Isolated Auth/Firestore emulator tests completed **19/19**, Hosting verifier tests **4/4**, and Hosting Emulator routing test **1/1**; all had zero failures. The skipped tests are emulator-dependent and were run separately against isolated `demo-*` projects where supported.
- A fresh build to a unique temporary directory completed successfully after transforming **1,885 modules**; the Hosting verifier confirmed both configured sites share `dist` and all **3** local JS/CSS references exist. The Hosting Emulator verified existing assets and SPA deep links while a missing `/assets/*.js` returned 404. Vite emitted large-chunk warnings (main **947.99 kB**, Three.js **568.17 kB**); this is not a build failure. `npm run lint`, the changed JavaScript `node --check` commands, and `git diff --check` passed. Temporary build/emulator directories were removed.
- Final preservation check: branch `release/partswala-launch-20261021`, HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce`, **55 modified tracked paths, 45 untracked files, 0 staged paths, 0 tracked deletions**. Ignored `dist/` remained at 2026-10-31 22:35 and ignored `firestore-debug.log` remained 62,227 bytes at 2026-10-31 19:44. Nothing was staged, committed, pushed, deployed, or published.
- Full backend `npm test -- --test-concurrency=1`: **252 total, 248 passed, 0 failed, 4 emulator-dependent skips**. The four Auth/Firestore emulator suites were rerun with a unique temporary config, a copy of the candidate rules, and project `demo-partswalaind`: **31 passed, 0 failed, 0 skipped**. This includes launch-boundary product/review/enquiry/quote checks, upload and bulk-import authorization, settlement denial, order-status mutation denial, and return approval/reverse-pickup denial.
- **Commerce-lock gaps fixed locally:** `/api/admin/finance/order` rejects the `settle` action and `/api/admin/orders/status` rejects all order-status mutations before database access. The admin return route also rejects refund approval and reverse-pickup scheduling while the permanent lock is active. The finance UI displays a disabled “Payouts disabled” button; order-status, COD reconciliation, shipping retry, refund, return-approval, and reverse-pickup controls are disabled, with matching service-layer guards for prohibited operations. Emulator fixtures prove an existing payable settlement/order remains unchanged and no `paidAt` is written; status changes do not mutate a seeded order; return pickup/approval attempts create no record. These checks cover launch time −1 ms, exactly at launch, and +1 ms.
- Frontend tests (`node --test --test-concurrency=1 <src test files>`): **26 passed, 0 failed, 0 skipped** after the commerce-control changes. `npm run lint` also passed. Hosting verifier tests (`node --test --test-concurrency=1 scripts/verifyHostingBuild.test.js`): **4 passed, 0 failed, 0 skipped** after the routing/cache config change.
- `npm run lint`, `node --check backend/server.js`, `node --check backend/vendorBulkImport.js`, `node --check backend/vendorEnquiries.emulator.test.js`, and `git diff --check` passed. Focused workbook parser/import API tests (`node --test --test-concurrency=1 vendorBulkImport.test.js vendorBulkImportApi.test.js`): **15 passed, 0 failed, 0 skipped**.
- Root `npm audit`: **0 vulnerabilities**. Backend `npm audit --omit=dev`: **0 production vulnerabilities**. Backend full `npm audit`: **15 moderate development-tool findings** in the `firebase-tools@15.34.2` dependency tree: GHSA-8988-4f7v-96qf (`@opentelemetry/core`), GHSA-3g3m-2fjr-6pw4 (`glob`), GHSA-g3hv-75wg-m249 (`minimatch`), and GHSA-w5hq-g745-h8pq (`uuid`). `npm audit fix --dry-run` proposed a breaking downgrade to `firebase-tools@13.11.2`; it was not applied. Production spreadsheet parsing now uses SheetJS `xlsx@0.20.3` from the official CDN package; focused `vendorBulkImport.test.js` + `vendorBulkImportApi.test.js` passed **15/15**, including XLS/XLSX mapping and malformed/size/row/column regressions. Backend `firebase-admin@14.5.0` requires Node `>=22`; local validation used Node `24.16.0`, but Render's runtime remains unverified.
- A fresh build to a unique temporary directory passed (Vite transformed **1,885 modules**). The Hosting verifier checked both configured sites share `dist` and confirmed all **3 local JavaScript/CSS references in `index.html`** exist. The temporary build and isolated emulator artifacts were removed; ignored repository `dist/` and `firestore-debug.log` were not overwritten. Vite reported the expected outside-project output notice and large-chunk warnings (main bundle **947.99 kB**, Three.js bundle **568.17 kB**). The emulator run also emitted a Firebase Admin credentials-option deprecation warning and an expected simulated Cloudinary failure log; all 31 tests passed.
- **Hosting routing regression:** `scripts/hostingRouting.emulator.test.js` passed **1/1** against the Firebase Hosting Emulator with a fresh temporary build and isolated `demo-partswala-hosting` config. It verified the entry JS/CSS and lazy Login chunk return correct MIME types, `/products/...` still gets the SPA document, and a nonexistent `/assets/*.js` returns 404 rather than the SPA document. The build verifier suite passed **4/4** and lint/syntax checks passed. Hosting Emulator response headers were not used as evidence for custom cache policies; the verifier checks the configured disjoint document-revalidation and fingerprinted-asset cache rules. Post-deployment HTTP cache checks remain required.
- **Latest read-only Hosting HTTP comparison confirms the reported chunk failure is production-side:** `partswalaind.com/` returned HTML referencing `index-zNSfCvEH.js`, `firebase-DneLkwbf.js`, and `index-BXIlST6V.css`; its HTML hash and asset references exactly matched `partswalaflutter.web.app/`, while `partswalaind.web.app/` served a different index referencing `index-DoXB2Cw6.js` and `index-Dp8DPtEq.css`. The `index-zNSfCvEH.js` bundle requests `Login-BrqCtMSN.js`; the `partswalaflutter.web.app` copy of that chunk returns **200 JavaScript**. On `partswalaind.com`, both the reported chunk and valid/missing asset paths returned **301 to the identical URL** (self-redirect). On `partswalaind.web.app`, the missing Login chunk returned **200 `text/html`**, confirming the SPA fallback masks missing JS assets. The domain root and missing-asset fallback responses showed `Cache-Control: max-age=3600`, so stale HTML references can persist. A read-only TLS handshake succeeded; the presented certificate SAN covers `partswalaind.com` and the certificate is valid through **2027-01-02 04:17:37 UTC**. Candidate `firebase.json` instead sets `Cache-Control: no-cache, max-age=0, must-revalidate` and both configured sites use one `dist`; neither local setting changes the live behavior until an approved deployment. The custom-domain site association, cause/owner of the self-redirect, and Firebase Console certificate/Hosting attachment status remain owner-confirmation blockers.
- Read-only production GETs on 2026-11-01 07:34 UTC reconfirmed: `/health` **200**; `/api/settings/public` **200/no-store**, with `preLaunchEnabled` present but `launchTime`, `serverTimeUtc`, and `millisecondsUntilLaunch` absent; `/api/public-products?limit=1` **200** and `/api/reviews?productId=launch-gate-readonly-probe` **200**, both without `Cache-Control`. Catalogue/review response bodies were not read or printed. These are confirmed live launch-gate blockers; do not deploy the candidate without an approved secure release and explicit owner authorization.
- Firebase CLI confirmed project `partswalaflutter`, sites `partswalaflutter` (`https://partswalaflutter.web.app`) and `partswalaind` (`https://partswalaind.web.app`). Their live Hosting releases are finalized versions `f9785433d9ff68f6` (2026-10-21 10:51:57 UTC, 52 files) and `7794259dc963f819` (2026-10-21 10:55:33 UTC, 61 files), respectively. The distinct finalized live versions establish that the two `web.app` sites currently serve independently released bundles; the domain mapping for `partswalaind.com` and certificate status cannot be established from this CLI metadata. Confirm both in Firebase Console → Hosting → each site → Custom domains. The Render service identity, deployed commit, and runtime also remain unconfirmed.
- Legal pages remain drafts pending owner confirmation of legal entity/address, grievance contact and timelines, retention/deletion/access procedures, and actual third-party cookie behavior; qualified Indian legal review is required. Production rules publication, real Cloudinary upload, real customer/vendor journeys, and deployed launch-gate verification remain unperformed.
- Final worktree inventory: **55 modified tracked files, 45 untracked files, 0 staged paths, 0 tracked deletions**. The pre-existing ignored `dist/` and `firestore-debug.log` were not overwritten. No staging, commit, push, deployment, DNS/settings change, or Firestore publication occurred.

### Release order

1. Freeze and review one immutable source revision containing the complete backend, shared code, frontend, Firestore rules, tests, and documents. Re-run `git status --short`, `git diff --check`, `npm run lint`, `npm run build`, and the focused backend/emulator tests from the release checkout. Do not deploy from a dirty worktree.
2. Obtain separate, explicit approval for Firestore rules publication. In the approved cutover window, publish the reviewed rules to the confirmed Firebase project to close raw Firestore product-read paths. Confirm the old frontend impact is coordinated; do not leave a public bypass open to preserve compatibility.
3. Deploy the backend first through the confirmed Render service using the approved revision. Verify health, launch settings, pre-launch denials, vendor authorization, CORS, and no-store headers before proceeding. Repository-compatible commands, if Render is configured for repository-root execution, are `npm ci --prefix backend` for build and `npm --prefix backend start` for start; confirm the actual Dashboard settings and branch first.
4. Build the approved frontend once with the confirmed production API URL, then deploy the same immutable `dist` independently to each confirmed Hosting site. Use `firebase deploy --only hosting:partswalaind --project partswalaflutter` and/or `firebase deploy --only hosting:partswalaflutter --project partswalaflutter` only for sites the owner confirms are active production targets. Confirm the custom-domain mapping before selecting a target.
5. Run the post-deployment checks below. Stop and use only the separately approved rollback procedure if any check fails. Do not publish rules, deploy, or change settings as part of this checklist without approval.

### Environment variable inventory (names only)

- Backend Firebase Admin initialization: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Backend runtime/CORS: `PORT`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`. `ALLOWED_ORIGINS`, when set, replaces the code defaults; verify every active Hosting origin is intentionally allowlisted.
- Cloudinary uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; `CLOUDINARY_UPLOAD_PRESET` is optional. Only test uploads with an approved test identity and isolated Cloudinary account.
- Optional AI providers: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`.
- Frontend build/runtime: `VITE_API_URL` or `VITE_BACKEND_API_URL`; optional `VITE_AI_API_URL` and `VITE_FIREBASE_VAPID_KEY` when push notifications are intentionally enabled. `VITE_FIREBASE_PHONE_AUTH_TESTING` is development-only and must not be enabled in production.
- Do not configure or enable commerce/shipping for this release: `PHONEPE_CHECKOUT_ENDPOINT`, `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`, `PHONEPE_REFUND_ENDPOINT`, `PHONEPE_REFUND_AUTH_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `VITE_RAZORPAY_KEY_ID`, `VITE_RAZORPAY_ORDER_ENDPOINT`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_PINCODE`, `SHIPROCKET_PACKAGE_LENGTH`, `SHIPROCKET_PACKAGE_BREADTH`, `SHIPROCKET_PACKAGE_HEIGHT`. While the permanent lock is false, provider callbacks are rejected without reconciling records; do not configure/use `PHONEPE_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, or `SHIPROCKET_WEBHOOK_SECRET` to imply callback processing is enabled. Reconciliation requires separate approval and transaction-binding review.
- Emulator-only variables include `GCLOUD_PROJECT`, `FIREBASE_PROJECT_ID`, `FIRESTORE_EMULATOR_HOST`, and `FIREBASE_AUTH_EMULATOR_HOST`; never point a test process at production.

### Firestore rules publication checklist

- Confirm Firebase project ID and rules target from the authorized owner; do not infer them from `.firebaserc`.
- Review the exact `firestore.rules` diff and run Auth/Firestore emulator tests with an isolated `demo-*` project. Confirm anonymous/customer product reads are denied before launch, admin/approved-owning-vendor product access remains permitted, and all browser-client review reads remain denied so public review access cannot bypass the launch-gated API.
- Record the current production rules release for rollback and obtain explicit rules-publication approval. Publish only the reviewed file using `firebase deploy --only firestore:rules --project <confirmed-project-id>`; do not combine this with Hosting commands.
- Verify the deployed rules release/version and the authorized access matrix using client credentials, never Admin SDK reads. Do not create production fixtures or expose product/customer records.

### Post-deployment test expectations

- `GET /health` is healthy. `GET /api/settings/public` returns the exact target `2026-11-07T18:30:00.000Z`, a server UTC timestamp, consistent `preLaunchEnabled`, and `Cache-Control: no-store`.
- Before launch, unauthenticated catalogue listing/detail/by-IDs and review GETs return 403 with no protected data and no-store. At/after the target, public GET APIs open without redeployment. Verify at the exact UTC instant in isolated clock tests and use read-only production checks at launch.
- Approved admin and approved vendor test identities can sign in and access only their permitted pre-launch workflows; pending/rejected/suspended vendors fail direct protected APIs. Verify `/api/vendor/access` and ownership-scoped product/enquiry/quote operations.
- CORS preflight from each confirmed Hosting origin returns 204 with that exact origin; an unapproved origin returns 403 with no allow-origin header.
- Upload checks use a generated test image: unauthenticated/unapproved/foreign-owner attempts fail; invalid MIME/signature and files over 5 MiB on the vendor product endpoint or 8 MiB on the general proxy fail; direct browser signature requests return 410; only the isolated Cloudinary test account returns a secure URL. Do not use a production customer/vendor listing as test data.
- The enquiry-to-quote workflow is exercised only with emulator or explicitly approved staging identities; verify customer visibility, owning-vendor visibility, quote response visibility, and notification recipients without sending production notifications.
- Direct customer attempts at checkout quote, order creation, PhonePe/Razorpay payment creation/verification, and Shiprocket shipment creation remain disabled both before and after launch. These tests must not initiate provider calls or create production records.
- Signed payment/shipping callbacks now return `503 COMMERCE_UNAVAILABLE` before accessing or mutating Firestore while commerce is disabled. Local tests cover PhonePe payment/refund, Razorpay capture, Shiprocket tracking, and the `/api/logistics/webhook` alias before, exactly at, and after the launch time. The previous PhonePe transaction-ID/amount binding concern remains relevant before any future, separately approved callback reconciliation; do not re-enable callbacks until provider contract and transaction binding are reviewed.

### Rollback and owner actions

- Hosting rollback: use Firebase Console release history for each confirmed site and restore its last known-good reviewed bundle; verify both `*.web.app` and custom domain. Do not change DNS.
- Render rollback: use the confirmed Render service’s deploy history to restore only a previously validated secure backend. Never roll back to the known older backend that exposed catalogue/reviews before launch and lacked `/api/vendor/access`; if no secure revision exists, stop rollout and request an owner-approved fail-closed response.
- Firestore rollback: only with separate rules-owner approval, restore the recorded prior rules release and immediately rerun the emulator/access matrix.
- Remaining owner-only evidence: exact Render service/settings and production env-name presence; Firebase site/domain ownership and deployed rules version; authorized test identities; Cloudinary test account; and deployment/rollback approval. Do not claim production readiness from local tests.
