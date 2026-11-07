# PartsWalaIND production handoff — November 6, 2026

## Status and safety

This is a handoff, not deployment authorization. The current candidate is local-only, on branch `release/partswala-launch-20261021`, at HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce`. Current status is 56 modified tracked paths plus 65 untracked files (**121 paths total**), 0 staged paths, and no tracked deletions. Compared with the saved 117-path manifest, the four additions are the Firestore access-matrix emulator test, vendor-submission helper/test, and shipping-service stub cleanup. It is not a clean deployable commit. Do not deploy this worktree directly, publish rules, change DNS, or change production settings until the release owner approves a reviewed immutable commit and the production blockers below are closed.

### Latest local validation — 2026-11-06

- The invalid-clock launch-gate correction is local only. Timestamps outside JavaScript's valid `Date` range and other invalid clock values fail closed, including for admin access; public settings return HTTP 503 with `Cache-Control: no-store` rather than emitting invalid date values. The launch instant remains **2026-11-08 00:00 IST** (`2026-11-07T18:30:00.000Z`).
- Latest isolated-candidate validation: backend with isolated Auth and Firestore emulators **301 passed, 0 failed, 0 skipped**; backend pricing/shipping tests **57 passed, 0 failed, 0 skipped**; focused launch/policy/settings tests **24 passed, 0 failed** (previously recorded); frontend Node tests **35 passed, 0 failed, 0 skipped**; lint passed with generated validation outputs excluded; Hosting build verification passed; Hosting Emulator routing passed **1/1** against the latest build. The production build succeeded with the existing large-chunk warning. The backend suite was not rerun after the frontend-only submission-form and shipping-stub cleanups.
- The Firestore access matrix now covers document access for notifications/tokens, user writes, orders/finance, vendor applications/submissions, presence, and list/query behavior for products, categories, settings, coupons, and campaigns. The expanded matrix passed against the actual emulator. Collection-list/query coverage for user profiles, device tokens, vendor applications, presence, product-cost/order-finance records, and some administrative collections remains incomplete; this is a coverage limitation, not a confirmed rules defect. Rules publication still requires owner review and is not authorized here.
- No countdown has been implemented. The client refreshes launch status on a fixed 30-second poll; this is not countdown calculation or display.
- No production deployment or post-fix production verification has occurred. Earlier production probes recorded below are historical evidence of blockers and do not verify the local correction. Production remains **NO-GO**.
- No Firestore rules publication, DNS change, production write, staging, commit, or push occurred. Protected `dist/` and Firestore debug logs remain untouched.

## Historical read-only production findings — 2026-11-01

These anonymous GET probes confirmed a **pre-launch NO-GO** at that time. The later November 6 observations are recorded below. Payload values were not copied into this handoff:

| Target | Observed result | Consequence |
|---|---|---|
| Render `/health` | 200 JSON | Health endpoint responds. |
| Render `/api/settings/public` | 200, `Cache-Control: no-store`; only `preLaunchEnabled` and `comingSoonVideoUrl` were present. | Deployed response does not match the candidate launch-status contract. |
| Render `/api/public-products?limit=1` | 200, no `Cache-Control`, one product present. | Confirmed anonymous pre-launch data disclosure; critical NO-GO. |
| Render `/api/public-products/{live product ID}` | 200, no `Cache-Control`, product present. | Direct-detail disclosure also confirmed. |
| Render `/api/reviews?productId=launch-gate-readonly-probe` | 200, no `Cache-Control`, no reviews present for this probe. | Reviews route did not reject before launch. |
| `partswalaind.com` | HTML 200 with `max-age=3600`; bundle paths differ from `.web.app`. Sampled JS assets and a product deep link returned a self-redirect to the same URL. | Active release/domain routing mismatch requires owner investigation. |
| `partswalaind.web.app` | HTML 200 with `max-age=3600`; existing Login lazy chunk returned JavaScript; a missing `/assets/*.js` path returned HTML 200; product deep link returned HTML 200. | Live behavior does not match the candidate's tested asset-excluding rewrite/cache configuration. |

These observations establish what the anonymous endpoints returned on November 1, but do not identify the active Render service, source repository/branch, deployed SHA, Firebase custom-domain attachment, or cause of the `.com` self-redirect.

### Candidate release path (not executed)

No Render manifest or deploy script exists in the repository. Render service details must be confirmed by the owner. Repository imports show the backend requires the repository root, not an isolated `backend/` source tree; candidate commands to verify against the existing Render service are build `npm ci --prefix backend`, start `npm --prefix backend start`, and health check `/health`. The exact deployable artifact is the **complete repository snapshot at one reviewed immutable SHA**, including the backend gate files and their sibling `shared/` and `src/` runtime dependencies—not the current dirty worktree or `c7e889f` base SHA. This work session did not create an immutable commit or deploy.

Firebase Hosting entries `partswalaflutter` and `partswalaind` both use `dist`, exclude `/assets/**` from SPA fallback, revalidate non-assets, and cache fingerprinted assets immutably. Hosting site releases are independent. In Firebase Console, the owner must check project `partswalaflutter` → Hosting → each site → Custom domains for the `.com` attachment and SSL status, then approve which site(s) should receive the reviewed identical frontend build. Local config cannot repair an unknown custom-domain association or prove why production `.com` redirects to itself.

The customer launch target is **2026-11-08 00:00 IST** (`2026-11-07T18:30:00.000Z`). Checkout, order creation, online payment, and shipping remain disabled even after that time unless separately approved.

## Release package inventory and safety review — 2026-10-31

The inventory checkpoint covered **45 modified tracked paths and 28 untracked files** (73 paths total; 0 staged). Subsequent local fixes added vendor-contact, legal-policy, chunk-load recovery, launch-boundary regression coverage, Hosting build verification, a validated authenticated image-upload proxy, permanent commerce callback locks, dependency remediation, and invalid-clock fail-closed coverage. The 2026-11-01 historical inventory had 55 modified tracked paths and 45 untracked files (**100 paths total**); the latest 2026-11-06 pre-documentation check has **55 modified tracked paths plus 62 untracked files (117 paths total)**, 0 staged, and 0 tracked deletions. Everything remains local; nothing was staged, committed, discarded, or deployed. Untracked runtime files must be included in any later approved immutable release snapshot. Tests and both handoff documents should accompany that snapshot for review, even though tests/docs are not served in production.

### Backend runtime — required for the release

- `backend/ai/authorization.js`
- `backend/authentication.js`
- `backend/commerceAvailability.js`
- `backend/marketplaceLaunch.js`
- `backend/notifications.js`
- `backend/publicProductCatalogRoutes.js`
- `backend/publicSettings.js`
- `backend/server.js`
- `backend/vendorContact.js` (untracked)
- `backend/legalAcceptance.js` (untracked)
- `backend/vendorProductImages.js`

### Frontend, shared runtime, Hosting assets, and Firestore rules — required for the release

- `firestore.rules`
- `public/sw.js`
- `public/firebase-messaging/firebase-messaging-sw.js` (untracked)
- `shared/commerceAvailability.js` (untracked)
- `shared/legalPolicies.js` (untracked)
- `shared/preLaunch.js`
- `shared/publicSiteSettings.js`
- `src/App.jsx`
- `src/ai/components/AssistantWidget.jsx`
- `src/ai/services/assistantApi.js`
- `src/components/Header.jsx`
- `src/components/NavBar.jsx`
- `src/components/NotificationBell.css` (untracked)
- `src/components/NotificationBell.jsx` (untracked)
- `src/components/LegalPolicyLinks.jsx` (untracked)
- `src/components/ShippingEstimateCard.jsx`
- `src/components/WhatsAppButton.jsx`
- `src/components/productcard.jsx`
- `src/context/AuthContext.jsx`
- `src/firebase.js`
- `src/index.css`
- `src/main.jsx`
- `src/pages/Cart.jsx`
- `src/pages/CommerceUnavailable.jsx` (untracked)
- `src/pages/ComingSoon.jsx`
- `src/pages/Home.jsx`
- `src/pages/LegalPolicies.jsx` (untracked)
- `src/pages/ProductView.jsx`
- `src/pages/Products.jsx`
- `src/pages/SellParts.jsx`
- `src/pages/SupplierEnquiries.jsx` (untracked)
- `src/pages/VendorLogin.jsx`
- `src/services/backendApiUrl.js` (untracked)
- `src/services/cloudinaryService.js`
- `src/services/notificationService.js` (untracked)
- `src/services/orderService.js`
- `src/services/phoneVerificationService.js`
- `src/services/productService.js`
- `src/services/reviewService.js`
- `src/services/supplierEnquiryService.js` (untracked)
- `src/services/vendorAccessService.js` (untracked)
- `src/services/vendorBulkImportService.js`
- `src/services/vendorProductImageValidation.js` (untracked)
- `src/services/legalAcceptanceService.js` (untracked)

The frontend and backend API contracts were checked together: settings fields match the strict frontend validator; frontend requests target the backend catalogue, vendor-access, enquiry, quote, and image routes; vendor approval and ownership are checked server-side; launch-denied API responses are no-store; and the Hosting rewrite supports direct SPA routes. A final audit also found that the buyer enquiry-list API was still readable by an authenticated customer before launch. The local handler now denies customer-profile reads pre-launch while leaving approved-vendor enquiry lists and quote PATCH operations intact; the emulator test asserts both sides of that exception. The two Hosting entries consume the same `dist`, so build exactly once from the approved immutable candidate SHA. They have separate live releases; do not assume their custom-domain mapping or current release is identical.

### Regression tests — required in the review package

- `backend/ai/authorization.test.js`
- `backend/ai/tools.test.js`
- `backend/authentication.test.js`
- `backend/commerceAvailability.test.js` (untracked)
- `backend/cors.test.js` (untracked)
- `backend/firestoreLaunchGate.emulator.test.js` (untracked)
- `backend/firestoreRules.test.js`
- `backend/notificationRules.test.js` (untracked)
- `backend/notifications.test.js` (untracked)
- `backend/preLaunch.test.js`
- `backend/publicProductCatalogRoutes.test.js`
- `backend/publicSettings.test.js`
- `backend/publicSiteSettingsClient.test.js`
- `backend/vendorBulkImport.emulator.test.js`
- `backend/vendorEnquiries.emulator.test.js`
- `backend/vendorProductImages.test.js` (untracked)
- `backend/cloudinaryUploads.emulator.test.js` (untracked)
- `backend/commerceWebhooks.test.js` (untracked)
- `backend/vendorContact.test.js` (untracked)
- `backend/legalAcceptance.test.js` (untracked)
- `backend/legalAcceptanceRules.test.js` (untracked)
- `src/services/backendApiUrl.test.js` (untracked)
- `src/services/productService.test.js` (untracked)
- `src/services/supplierEnquiryService.test.js` (untracked)
- `src/services/vendorAccessService.test.js` (untracked)
- `src/services/vendorProductImageValidation.test.js` (untracked)
- `src/services/legalAcceptanceService.test.js` (untracked)
- `src/pages/LegalPolicies.test.js` (untracked)

### Vendor bulk-import mapping and validation

- `backend/vendorBulkImport.js` updates the import template and required columns to capture description, MRP, selling price, stock, and compatibility explicitly. It rejects missing required data and malformed numeric values rather than inventing category, price, or compatibility defaults; it also validates workbook signatures and bounds parsed spreadsheet size. The paired parser, mapping, and emulator tests are part of the release candidate.

### Existing release documents — update together

- `docs/LAUNCH-READINESS-RUNBOOK.md`
- `docs/NOV-6-PRODUCTION-HANDOFF.md`

### Secret, generated-file, and runtime review

- A sanitized high-confidence pattern scan found no private key block, token/JWT, AWS credential, GitHub token, or live payment-key pattern in the 73 candidate paths. It did match the Firebase browser API-key shape in `src/firebase.js`; this is public client configuration shipped to browsers, not a Firebase Admin/service-account secret. Firebase/Google API restrictions and authorized domains still require owner confirmation. No `.env` file is present in the candidate; only root and backend `.env.example` templates exist.
- Emulator tests generate local ephemeral keys; no generated keys are committed. `firestore-debug.log` is an existing ignored file and was deliberately not read, changed, or included in the release inventory.
- No generated build output is included in the worktree inventory. Build to `dist` only from the reviewed immutable commit after approval; do not treat a stale local `dist` as a release artifact.
- The backend imports shared modules from sibling `src/` and `shared/` directories and uses modern Node APIs (`fetch`, `FormData`, `AbortSignal.timeout`). No `render.yaml`, Dockerfile, Procfile, or Node engine pin was found. The Render owner must confirm the complete repository is available at runtime/build time and choose a compatible modern Node runtime.
- The notification sender persists an in-app notification before push delivery; if push delivery fails, deduplication can prevent retrying the same push event. The in-app record remains; this is a known delivery/retry limitation, not a credential exposure.

## Verified production observations — 2026-10-31

These were read-only requests. Response bodies containing catalogue or customer data were intentionally omitted.

| Target | Observed result |
|---|---|
| `GET https://partswala-ind.onrender.com/health` | HTTP 200. |
| `GET https://partswala-ind.onrender.com/api/settings/public` | HTTP 200, `Cache-Control: no-store`; `preLaunchEnabled: true`, but `launchTime`, `serverTimeUtc`, and `millisecondsUntilLaunch` were null/missing. The candidate frontend rejects this response and remains closed. |
| `GET https://partswala-ind.onrender.com/api/public-products?limit=1` | HTTP 200 before launch, no `Cache-Control` header. Response body not printed. **Confirmed release blocker:** direct public API request succeeds before the target. |
| `GET https://partswala-ind.onrender.com/api/reviews?productId=launch-gate-readonly-probe` | HTTP 200 before launch, no `Cache-Control` header. **Confirmed release blocker:** the deployed reviews route does not enforce the required gate. |
| CORS preflight for `/api/public-products?limit=1` from `https://partswalaind.com` | HTTP 204; allowed origin was the requesting production domain; allowed methods and headers included GET and Authorization. CORS from `https://partswalaind.web.app` was also observed on public settings. |
| CORS preflight from `https://unapproved-origin.example` | HTTP 500 and no `Access-Control-Allow-Origin` header. The browser cannot read the response, but the server surfaces a 500 rather than a clear 403; treat as an operational error to correct in the reviewed backend. |
| Unauthenticated `GET /api/vendor/dashboard`, `/api/vendor/enquiries`, `/api/enquiries`, `/api/vendor/import-template`, `/api/admin/products/pending-vendor`, and `/api/admin/pickup-locations` | HTTP 401 with “Authentication required”; response bodies contained no credentials. |
| Unauthenticated `GET /api/vendor/access` | HTTP 404. The local candidate's vendor frontend requires this route for its authoritative approval check. Production vendor approval access is not verified and deployed frontend/backend versions do not match the candidate contract. |
| `GET https://partswalaind.web.app/` | HTTP 200; Firebase Hosting response; title matched PartsWalaIND. Bundle paths observed: `/assets/index-DoXB2Cw6.js` and `/assets/index-Dp8DPtEq.css`. |
| `GET https://partswalaind.com/` | HTTP 200 over HTTPS; title matched PartsWalaIND. Bundle paths differed: `/assets/index-zNSfCvEH.js`, `/assets/firebase-DneLkwbf.js`, and `/assets/index-BXIlST6V.css`. Browser rendered the older “COMING SOON” surface with only an administrator sign-in link. |
| Direct GETs to `/products/direct-readonly-audit`, `/vendor/login`, `/profile`, and `/admin` on `partswalaind.web.app` | HTTP 200 SPA fallback. This proves document fallback, not route-level authorization or authenticated app behavior. |
| HTTP requests to `http://partswalaind.web.app/` and `http://partswalaind.com/` | Both redirected to their HTTPS URLs and completed with HTTP 200. |
| Render health first request | An initial request timed out after 30 seconds; a subsequent GET returned HTTP 200. |

Firebase CLI lists project `partswalaflutter` and Hosting sites `partswalaflutter` and `partswalaind`. Both production hostnames serve pages, but the different bundles mean they must not be assumed to serve the same release. The CLI did not expose a custom-domain-to-site mapping. A read-only deployed Firestore rules comparison was unavailable: the installed Firebase CLI has no `firestore:releases:list` command, and no rules were published.

## Production mismatch investigation — 2026-10-31

### Remote source comparison

Read-only GitHub branch metadata reports:

- `main` at `2289c99af9cb730b5869da38748a52f8e01889cb`.
- `release/partswala-catalogue-api-20261021-fast` at `c7e889f87860b261d99aeb3e556829d71acc90ce`.
- No remote `release/partswala-launch-20261021` branch. That name is the current local worktree branch; its HEAD is the `c7e889f` base, not a commit containing the current local edits.

The public `main` and `c7e889f` source expose the prior `backend/publicSettings.js` implementation: it returns only persisted `preLaunchEnabled` and `comingSoonVideoUrl`. It has no fixed launch timestamp, server time, or remaining-time fields. The live settings response has that same shape. The `c7e889f` `backend/server.js` registers the public catalogue without the current launch-clock option, and its reviews handler has no pre-launch rejection. Its CORS callback passes a generic error, which Express reports as HTTP 500. It has no `/api/vendor/access` handler. These source-level matches explain all five backend differences.

The local candidate changes the causes directly:

1. `backend/publicSettings.js` calculates the fixed `2026-11-07T18:30:00.000Z` launch instant from trusted server time and returns the complete validated settings shape. `backend/publicSettings.test.js` covers before/exactly-at/after and failure cases.
2. `backend/publicProductCatalogRoutes.js` rejects catalogue list/detail/by-ID access before launch and sets no-store on its responses. `backend/server.js` also applies the gate to reviews and other public marketplace routes. `backend/publicProductCatalogRoutes.test.js` and `backend/vendorEnquiries.emulator.test.js` cover these paths.
3. `backend/server.js` adds authenticated, authoritative approved-vendor verification at `/api/vendor/access`; its emulator regression tests cover anonymous, approved, pending/rejected/suspended, customer, and admin outcomes.
4. `backend/server.js` turns a disallowed CORS origin into an explicit 403. `backend/cors.test.js` asserts that denial and preserves the allowed production-origin preflight.
5. `src/App.jsx` grants only the vendor-login surface and approved vendor routes through the pre-launch gate; `shared/preLaunch.js` and `src/services/vendorAccessService.js` cover the route policy and server-verified access contract.

These are local worktree modifications, not a remotely published candidate commit. The live `200` catalogue and reviews responses, incomplete settings, `404` vendor-access response, and CORS `500` are consistent with an older backend source such as the published `c7e889f` branch. They do **not** prove which Render service, branch, environment, or commit is deployed. In particular, the live `/api/public-products` response establishes that the deployed service has that route, while the public `main` source does not register it; this makes the exact Render source/service identity especially important. Without Render dashboard metadata, it is not safe to conclude “wrong branch” versus “wrong service,” an unpublished source, or a separately deployed artifact.

The two Hosting configurations in `firebase.json` both use `dist`, but Firebase deploys each site independently. The matching SPA titles and different hashed bundles prove the two observed hostnames served different frontend releases at probe time. They do not prove which Firebase site owns `partswalaind.com` or distinguish a different site deployment from domain mapping/CDN staleness. The custom-domain browser showed Coming Soon with no vendor-login link; direct `/vendor/login` also rendered that older surface. The published `c7e889f` `src/App.jsx` has a global Coming Soon return that hides vendor login before launch. The local candidate has the narrow approved-vendor login exception, but is not deployed.

### Exact owner actions and safe order

1. **Render owner — identify before changing anything:** in Render Dashboard, match `partswala-ind.onrender.com` to the service ID/name, repository, configured branch, root, build/start commands, deploy status, latest deployed commit SHA, and environment-variable *presence* (never copy values). Compare that evidence to the intended reviewed candidate commit. Confirm whether the live service is serving the `c7e889f` catalogue branch, `main`, another source, or another service. Do not change settings or restart the service during this investigation.
2. **Release owner — prepare an immutable backend release:** review and approve the local security changes, tests, and source diff; publish them only through the normal approved source-control/release process. The current dirty worktree cannot be the exact deployed artifact. If Render points to the wrong service/branch, correct that association only after the owner confirms the intended service and explicitly approves the change. Otherwise deploy the reviewed commit through the confirmed existing service. No deployment was performed here.
3. **Backend owner — post-deployment read-only checks:** confirm `/health` is 200; `/api/settings/public` is no-store and contains the exact launch instant plus consistent server/remaining time; unauthenticated catalogue and reviews requests return 403 with no-store before launch; anonymous `/api/vendor/access` returns 401; approved vendor returns approved access while pending/rejected/suspended/customer/admin accounts are denied; an approved-origin OPTIONS request is 204; and an unapproved-origin OPTIONS request is 403 without `Access-Control-Allow-Origin`. Do not print catalogue payloads or use production write requests.
4. **Firebase owner — identify the mapping:** in Firebase Console, confirm which Hosting site is attached to `partswalaind.com`, compare its active release/version to `partswalaind.web.app`, and determine whether the mismatch is site association, an older site release, or cache. Confirm the intended project/site and align both domains only through an explicitly approved Hosting release. Do not change DNS.
5. **Release owner — publish the reviewed frontend to the confirmed site:** only after the site mapping and exact reviewed build are approved. Then verify both HTTPS domains serve the same approved asset manifest; directly visit `/vendor/login`, confirm vendor login renders pre-launch, and test the approved-vendor flow with an authorized test account. Confirm customer pages still show Coming Soon and candidate API calls reach the verified backend.
6. Repeat all live checks and record returned status/header evidence. Production remains blocked until backend and frontend parity, vendor access, deployed Firestore rules, and credentialed admin/vendor workflows are verified.

## Release-blocking manual actions

1. **Backend owner:** inspect Render Dashboard for the service serving `partswala-ind.onrender.com`; record service ID/name, repository, branch, root, build/start commands, health-check path, latest successful deploy commit, and environment-variable presence. Do not copy secret values into the handoff.
2. Resolve why deployed settings omit the fixed launch instant and why the catalogue and reviews endpoints still return HTTP 200 pre-launch. Deploy only the separately reviewed backend release after approval; do not make a temporary live-rule or frontend-only workaround.
3. Ensure the deployed backend supports the candidate's `/api/vendor/access` contract and preserves verified admin/vendor authorization, ownership filtering, no-store responses, notifications, and quote workflows.
4. **Firebase owner:** confirm in Firebase Console which Hosting site is attached to `partswalaind.com`, why the two hostnames currently serve different asset bundles, and which site is the approved production target. Confirm the deployed Firestore rules release/version against the approved candidate without publishing rules as part of this verification.
5. **Credentialed test operator:** use approved test-only admin, approved vendor, pending/rejected/suspended vendor, and customer identities to exercise the browser journeys below. No credentials were supplied to this audit.
6. **Cloudinary owner:** verify presence (not values) of required server variables and complete an approved test-account upload only after the backend fix is deployed. Do not use a real user's product, profile, or listing.
7. Release owner must separately approve the release commit, backend deployment, Hosting deployment, and any Firestore rules publication. Firestore rules publication is deliberately a separate approval.

## Pre-deployment candidate verification

Run from the reviewed candidate snapshot (not an arbitrary dirty worktree):

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

The frontend test discovery includes service, component, and page tests. Hosting build and routing checks use fresh temporary output and a temporary one-site emulator config; do not write into the protected repository `dist/`. The isolated Auth/Firestore suite, all frontend tests, Hosting verifier tests, and Hosting Emulator routing test must pass on the reviewed release revision.

The test totals in older sections below are historical. The latest isolated-candidate validation completed the full backend suite with Auth/Firestore emulators (**301 passed, 0 failed, 0 skipped**), backend pricing/shipping tests (**57 passed, 0 failed, 0 skipped**), all frontend Node tests (**35 passed, 0 failed, 0 skipped**), Hosting build verification, and Hosting Emulator routing (**1 passed, 0 failed, 0 skipped**) against the final build. Focused launch/policy/settings tests were previously recorded at **24 passed, 0 failed**. Lint and `git diff --check` passed; lint excluded generated build/emulator outputs. The backend suite was not rerun after the frontend-only submission-form and shipping-stub cleanups. The production build succeeded with the existing large-chunk warning. Historical emulator configs/logs and build outputs were kept outside the repo; the existing ignored debug logs and `dist/` were not touched. See the runbook for the complete verification sequence.

An initial focused emulator run caught the stale expectation that a buyer could read `/api/enquiries` pre-launch. The test was corrected to require 403 before launch and 200 at the exact launch instant; approved vendor enquiry list/quote access remained available. The final focused and full emulator runs passed.

Inspect the final release diff and confirm no commerce re-enable, launch-date change, private data, secrets, or unreviewed rules changes. Confirm Firestore emulator tests use a `demo-*` project and loopback endpoints. Do not stage, commit, or deploy as part of this handoff.

## Deployment procedure — only after explicit release approval

### Firebase Hosting

The repository configures two independent Hosting site IDs (`partswalaflutter`, `partswalaind`), both serving the same `dist`, with SPA fallback to `/index.html`; `.firebaserc` defaults to project `partswalaflutter`. Build once from the exact approved immutable commit. Firebase owner must confirm the custom-domain mapping and whether both sites are production-active. If both are confirmed for this application, deploy the same `dist` independently to each site; do not assume the deployed bundles or custom-domain mapping match.

```powershell
npm ci
$env:VITE_API_URL = 'https://partswala-ind.onrender.com'
npm run build
firebase deploy --only hosting:partswalaind --project partswalaflutter
firebase deploy --only hosting:partswalaflutter --project partswalaflutter
```

The API URL has a production fallback to the same Render endpoint, but explicitly confirm any `VITE_API_URL`, `VITE_BACKEND_API_URL`, and `VITE_AI_API_URL` build overrides do not target localhost or another service. Run each site deploy only after that site and its domain mapping are confirmed and separately approved. The commands deploy Hosting only, not Firestore rules.

### Render backend

There is no Render manifest or deploy script, so live service settings remain unverified. The backend package defines no build script, `start: node server.js`, and `test: node --test`; backend runtime imports sibling `src/` and `shared/` modules. A repository-compatible recommended service setup is repository root (blank/`.`), build command `npm ci --prefix backend`, start command `npm --prefix backend start`, health path `/health`, and a modern Node runtime supporting `fetch`, `FormData`, and `AbortSignal.timeout`. No Node engine is pinned in the repository. Render owner must confirm service identity, repository, branch, root, commands, runtime version, health path, auto-deploy policy, and environment-variable presence before deployment. Do not configure an isolated backend root unless the owner verifies sibling imports remain available.

Required at runtime for Firebase Admin initialization: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Verify presence only. Also confirm `FRONTEND_URL`, `ALLOWED_ORIGINS`, and `TRUST_PROXY`; if `ALLOWED_ORIGINS` is configured, it replaces the code defaults and must list exactly the approved active Hosting origins (including `https://partswalaflutter.web.app` only if that site is active). Uploads require `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; upload preset is optional. No commerce/payment/shipping credentials or switches should be enabled by this release.

### Firestore rules

`firebase.json` points to `firestore.rules` in project `partswalaflutter`. Rules are not part of either procedure above. Do not run `firebase deploy --only firestore:rules` until the rule diff, emulator result, production project, and explicit rules-publication approval have all been confirmed.

## Deployment verification

Immediately after each separately approved deployment, record timestamp, service/site, release/version ID, commit, and operator. Do not record tokens or user data.

1. Backend: GET `/health`; GET `/api/settings/public`; verify `launchTime` is exactly `2026-11-07T18:30:00.000Z`, `serverTimeUtc` is valid server UTC, and `preLaunchEnabled` is consistent with server time. Verify API responses use `Cache-Control: no-store`.
2. Before launch: GET `/api/public-products?limit=1`, a direct product detail API, reviews API, and relevant customer APIs without credentials. Expected: blocked status, no catalogue/review data, and no-store. Do not print product records. Verify authenticated admin exceptions only where intentionally authorized.
3. Verify approved vendor access with an approved test identity, and confirm pending/rejected/suspended test identities fail. Confirm all vendor-owned reads/writes are owner-filtered. Confirm `/api/vendor/access` returns the contract expected by the frontend.
4. Verify CORS for each confirmed Hosting origin: OPTIONS returns 204 with the exact requesting allowlisted origin. A disallowed origin returns 403 and no `Access-Control-Allow-Origin` header (not an HTTP 500).
5. Verify the selected Hosting site and custom domain serve the same approved bundle and that direct customer URLs render Coming Soon before launch. Open one page before the instant and confirm it unlocks at/after the target without refresh.
6. Verify Firestore rules release/version and run the approved anonymous/customer/admin/vendor access matrix without writing production fixtures.
7. Confirm checkout, order creation, payment initiation, and shipping remain unavailable before and after the launch time.

## Credentialed browser tests (test identities only)

- **Admin:** sign in through `/admin/login`; confirm server-verified admin status, admin dashboard data load, product/vendor/enquiry management, and visible error handling. A regular authenticated account must be redirected/denied.
- **Approved vendor:** sign in through `/vendor/login`; verify authoritative `/api/vendor/access`; open dashboard, products, import, profile, and `/vendor/enquiries`; confirm only owned products/enquiries are accessible and a quote can be submitted to an isolated test enquiry.
- **Unapproved vendor:** pending, rejected, and suspended identities must be denied at login routing and direct APIs; no direct URL may render protected workflows.
- **Customer:** before launch, homepage/product/direct API access stays gated; after launch, catalogue access opens. With a test account after launch, submit one enquiry to an isolated test listing, confirm only its owner vendor sees it, submit a quote, and confirm only the buyer sees the response. Use test notification tokens or disable push; never notify a real customer/vendor.
- **Upload:** use a generated tiny JPEG test fixture and a test vendor/product. Check unauthenticated and unapproved denial, foreign-owner denial, invalid MIME/signature rejection, >5 MiB vendor-product and >8 MiB general-upload rejection, old direct-signature endpoint `410`, and one successful Cloudinary test-account upload. Delete test media only using the approved test-account process.

No production enquiry, quote, notification, or upload was created by this audit.

## Rollback

Rollback is a separate operator action requiring release-owner approval. First stop further rollout; capture the failed release ID, commit, time, and sanitized error summary.

- **Firebase Hosting:** in Firebase Console → Hosting → release history for the confirmed production site, select the last known-good version and use the console rollback action. Verify both the canonical domain and `partswalaind.web.app` return the expected prior bundle and continue to fail closed. Do not change DNS.
- **Render:** in Render Dashboard → the confirmed backend service → Events/Deploys, redeploy a previously validated secure deployment using the service's rollback control. The currently observed prior backend is known to expose catalogue/reviews pre-launch and lacks `/api/vendor/access`; do **not** roll back to that version as routine recovery. If no secure prior exists, stop rollout and have the owner deploy a reviewed corrective backend or use an owner-approved fail-closed maintenance response. Verify `/health`, public settings, pre-launch API denials, vendor authorization, CORS, and cache headers after recovery.
- **Firestore:** do not roll rules back automatically with application code. If an approved rules deployment is ever made and causes an access regression, obtain explicit rules rollback approval, restore the recorded previous rules release in Firebase Console, and rerun the emulator/access matrix.
- A frontend-only rollback is not an adequate mitigation for a backend launch-gate failure. Keep the public launch blocked until server checks pass.

## Environment variable names to verify (presence/config only; never values)

- Required backend Firebase Admin initialization: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Backend operational/CORS: `PORT` (Render supplies it), `FRONTEND_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`. If an explicit origin list is present, confirm it matches only approved active Hosting origins.
- Approved Cloudinary product uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; `CLOUDINARY_UPLOAD_PRESET` is optional.
- Optional assistant providers: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`.
- Frontend build: `VITE_API_URL` or `VITE_BACKEND_API_URL`, optional `VITE_AI_API_URL`, and `VITE_FIREBASE_VAPID_KEY` only if push notifications are enabled. Current Firebase web client configuration is embedded in `src/firebase.js`; it is public configuration, not a server credential. Never put server secrets in `VITE_*`.
- Legacy commerce/payment/shipping variables are **not release prerequisites** and must not be added or changed for this release: `PHONEPE_CHECKOUT_ENDPOINT`, `PHONEPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_API_URL`, `SHIPROCKET_WEBHOOK_SECRET`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_PINCODE`, `SHIPROCKET_PACKAGE_LENGTH`, `SHIPROCKET_PACKAGE_BREADTH`, `SHIPROCKET_PACKAGE_HEIGHT`. Checkout, order creation, online payment, and shipping remain disabled regardless of whether legacy values exist.

## Current verdict

**NOT READY for production release.** The deployed backend currently serves the public catalogue and reviews before the launch instant, has incomplete launch settings, lacks catalogue/reviews no-store headers, and does not expose the vendor approval endpoint required by this candidate. Hosting bundle mismatch, deployed Firestore rules, authenticated admin/vendor browser journeys, and Cloudinary production configuration remain unverified. Local tests do not make these production failures safe.

## Final candidate review addendum — 2026-10-31

### Confirmed local fixes

- Vendor image upload requests now use Firebase token-revocation checks, matching other sensitive vendor routes. Regression coverage is in `backend/authentication.test.js`.
- Product detail WhatsApp links now route to the listing's seller. PARTSWALA listings keep the existing PARTSWALA contact; vendor listings use only explicitly public contact fields, and never fall back to ambiguous profile/product phone fields. Missing/invalid vendor contact hides the direct-contact button, while API errors tell the user to use the quote form. Regression coverage is in `backend/vendorContact.test.js` and `src/services/productService.test.js`.
- A filename-only scan for common private-key, AWS, payment-token, and GitHub-token formats returned no matches; no secret values were printed. The Firebase browser API-key shape noted in the earlier inventory is public client configuration, not a server credential.
- These are local changes only. They do not prove that the deployed backend, Hosting sites, Firestore rules, Cloudinary account, or provider callbacks are configured correctly.

### Legal & Policies implementation — draft pending owner/legal approval

- Added seven responsive policy routes: Privacy, General Terms, Vendor Terms, Disclaimer, Contact & Grievance, Cookie & Browser Storage, and Enquiry & Quotation. They are linked from the footer and remain accessible on the pre-launch Coming Soon surface. Customer and vendor registration forms link to their applicable terms and require unchecked policy acceptance; marketing is a separate optional unchecked choice.
- Successful form acceptance is posted to authenticated `POST /api/legal/acceptance`. The backend stores accepted policy IDs/versions, server timestamp, audience, and the optional marketing choice in backend-only `legalAcceptances`; local Firestore rules deny browser access. If backend recording fails during customer registration, the screen offers an explicit retry and does not silently continue.
- Enquiry form includes a short privacy notice and separate unchecked email-sharing consent. The policy copy reflects the current Firebase Auth/Firestore persistent cache, local cart/recent-view storage, page-only service-worker caching, optional push registration, Cloudinary uploads, and configured AI processing. No direct cookie access or analytics/ad SDK was found in the reviewed source.
- These are drafts, not legal approval. Before publication the owner must provide legal entity/registered address and grievance officer identity/contact/timelines, define record retention and deletion/access requests, verify third-party cookie behavior, and obtain qualified Indian legal review including applicable data-protection and e-commerce obligations. The account deletion UI currently deletes the Firebase Auth account only; it does not erase associated records.
- `shared/legalPolicies.js`, `backend/legalAcceptance.js`, `src/services/legalAcceptanceService.js`, `src/pages/LegalPolicies.jsx`, and `src/components/LegalPolicyLinks.jsx` plus their tests are required release paths. `backend/legalAcceptanceRules.test.js` checks that clients cannot read/write audit records. Do not publish local rules or policy text until the owner/legal blockers are resolved.

### Production lazy-chunk failure observed — 2026-10-31

- Read-only requests confirmed inconsistent live Hosting builds: `partswalaind.com/` referenced `/assets/index-zNSfCvEH.js`, while `partswalaind.web.app/` referenced `/assets/index-DoXB2Cw6.js`; both HTML responses advertised `Cache-Control: max-age=3600`.
- The exact reported `/assets/Login-BrqCtMSN.js` URL returned a 301 redirect to itself on the custom domain. On `partswalaind.web.app`, that same missing JavaScript path returned the SPA fallback as `200 text/html`, not JavaScript. The custom-domain bundle manifest references this Login chunk. These responses explain the browser's dynamic import failure and confirm a deployed asset/build mismatch; the domain-to-site ownership and release history still require owner/dashboard confirmation.
- The candidate now handles Vite `vite:preloadError` by retrying the page once per failed chunk and tab session. This is a recovery aid only; it cannot supply a missing production asset and is not present in the existing live build.
- Firebase CLI read-only metadata confirms project `partswalaflutter`, site IDs `partswalaflutter` and `partswalaind`, default URL `https://partswalaind.web.app`, and the `partswalaind` live release timestamp displayed as 2026-10-21 16:25:33. CLI site metadata does not identify custom-domain ownership. The mapping of `partswalaind.com` to a site remains **UNVERIFIED** pending Firebase Console owner confirmation.
- SSL status also remains **UNVERIFIED**: the CLI site/channel commands available here report default Hosting URLs and release times, not custom-domain attachment or certificate status. Owner's read-only check: Firebase Console → project `partswalaflutter` → Hosting → **View** on each of `partswalaind` and `partswalaflutter` → **Custom domains**. Record which site lists `partswalaind.com`, any configured redirect, and the domain/certificate status shown. Do not change domain setup or DNS.
- Root cause established from live evidence: the domains serve different Hosting snapshots, the `.com` asset requests self-redirect, and the `web.app` SPA rewrite serves HTML for a missing asset. The exact live domain attachment/redirect owner is not identifiable from repository configuration or CLI site metadata. A `200` fallback response is not a successful JS asset check. The live one-hour cache reflects deployed behavior and does not match the candidate's current local policy.
- `firebase.json` is updated locally only: both Hosting site entries remain present and point to the same `dist`; their SPA rewrites exclude `/assets/**`, so missing assets no longer rewrite to the app shell while other deep links continue to work. Non-asset routes/documents revalidate; fingerprinted Vite files under `/assets/**` use a one-year immutable cache policy. Existing static files still take precedence over rewrites. This does not resolve the custom-domain self-redirect or make separate production releases consistent, and has not been deployed.
- `scripts/verifyHostingBuild.js` and its tests now check both configured site IDs share `dist`, require the asset-excluding SPA rewrite and separate cache rules, and verify local JS/CSS references in built `index.html`. The new `scripts/hostingRouting.emulator.test.js` runs against a fresh temporary build and verifies direct SPA routes, JS/CSS MIME types, the lazy Login chunk, and 404 (not SPA HTML) for a missing asset. The Emulator did not provide reliable evidence for configured response-cache headers in this run; those are structurally checked by the verifier and still require an approved post-deployment HTTP check.
- At the 2026-10-31 local check: Vite built 179 modules into a unique temporary output; the verifier confirmed all four then-current `index.html` JS/CSS references. Three verifier regression tests passed, including rejection of an implicit `dist` path and a missing asset. This historical result is superseded by the latest local validation below. The pre-existing ignored `dist` was left untouched.
- Owner-approved deployment checklist: (1) confirm `partswalaind.com` ownership and SSL/certificate status in Firebase Console → Hosting → **View** each site → **Custom domains**; (2) confirm intended status of both sites; (3) approve one immutable source revision and build once to `dist`; (4) run the local build verifier; (5) deploy the same `dist` separately to each confirmed site, retaining both sites; (6) after deployment, check each domain's HTML entry asset and every referenced JS/CSS URL, including the Login chunk, for HTTP 200 and correct JavaScript/CSS MIME types; (7) check missing chunk behavior and cache headers; (8) compare bundle identifiers on both intended domains and confirm they correspond to the approved release; (9) record Firebase release IDs and retain rollback releases. Do not deploy, change DNS, or change production settings as part of this investigation.

### Required release order and commands

Do not deploy the current dirty worktree. After owner review and an approved immutable release revision:

1. Confirm the Render service, branch, root, runtime, commands, environment-variable presence, Firebase project, Hosting sites/domain mappings, and current rules release in their respective dashboards. Do not print secret values.
2. Obtain separate Firestore rules publication approval. Review the exact rules diff and emulator results; coordinate rule publication immediately before the backend cutover because older frontends may depend on previously public Firestore reads.
3. Publish the approved Firestore rules to the confirmed project as a separate action using `firebase deploy --only firestore:rules --project <confirmed-project-id>`. Do not continue if the publication result or access matrix is unclear.
4. In the confirmed Render service, deploy the approved backend revision first. Repository-compatible root execution uses build `npm ci --prefix backend` and start `npm --prefix backend start`; confirm this against Render Dashboard rather than assuming the live configuration.
5. Verify backend health, public settings, pre-launch API denials, authorized vendor/admin access, CORS, no-store headers, and disabled commerce before deploying frontend assets.
6. Build once from the same immutable revision with the confirmed API endpoint. Deploy the same `dist` independently to each owner-confirmed production site:

   ```powershell
   npm ci
   $env:VITE_API_URL = 'https://partswala-ind.onrender.com'
   npm run build
   firebase deploy --only hosting:partswalaind --project partswalaflutter
   firebase deploy --only hosting:partswalaflutter --project partswalaflutter
   ```

   Run only the Hosting command(s) for sites confirmed by the owner; do not assume both sites or the custom domain share a mapping. The commands do not publish Firestore rules.
   Before deployment, run `npm run verify:hosting-build -- dist`; after deployment, verify every script/stylesheet URL from each domain's HTML returns the expected asset content type. The current live mismatch is not resolved until both intended domains pass these checks against the approved release.
7. Re-run the post-deployment test matrix below and record sanitized status/results. Stop on any mismatch.

### Environment variable names to verify (names only)

- Required Firebase Admin: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Runtime/CORS: `PORT`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`; inspect presence/configuration only. A configured `ALLOWED_ORIGINS` replaces defaults.
- Uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; `CLOUDINARY_UPLOAD_PRESET` optional.
- Optional AI: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`.
- Frontend build: `VITE_API_URL` or `VITE_BACKEND_API_URL`, optional `VITE_AI_API_URL` and `VITE_FIREBASE_VAPID_KEY` when push is enabled. `VITE_FIREBASE_PHONE_AUTH_TESTING` is development-only. Never put secrets in `VITE_*`.
- Checkout/payment/shipping must remain disabled and must not be enabled by provisioning: `PHONEPE_CHECKOUT_ENDPOINT`, `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`, `PHONEPE_REFUND_ENDPOINT`, `PHONEPE_REFUND_AUTH_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `VITE_RAZORPAY_KEY_ID`, `VITE_RAZORPAY_ORDER_ENDPOINT`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_PINCODE`, `SHIPROCKET_PACKAGE_LENGTH`, `SHIPROCKET_PACKAGE_BREADTH`, `SHIPROCKET_PACKAGE_HEIGHT`. While the permanent lock is false, callbacks using `PHONEPE_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `SHIPROCKET_WEBHOOK_SECRET` are rejected before Firestore access; do not configure these names as evidence that reconciliation is enabled. Emulator-only names include `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, and `FIREBASE_AUTH_EMULATOR_HOST`.

### November 7 final verification checklist (scheduled; not performed here)

1. Confirm immutable release SHA, no dirty/staged files in the release checkout, and owner-approved backup/rollback targets. Run `git status --short`, `git diff --check`, `npm run lint`, `npm run build`, and the focused backend tests/emulator matrix using `demo-*` only.
2. Confirm dashboard evidence for Render service/branch/root/build/start/Node runtime and variable names; Firebase project/site IDs/domain ownership/rules version; and Cloudinary test-account availability. Stop if mappings or deployed build identifiers differ.
3. After approved deployment, verify `/health`, exact launch settings, pre-launch catalogue/detail/by-IDs/reviews 403 denials with no-store, admin access, approved-vendor `/api/vendor/access`, pending-vendor direct denial, approved/disallowed CORS responses, and frontend asset identity at every confirmed domain.
4. On isolated emulator/staging fixtures, verify image MIME/signature/5 MB/ownership checks and successful test-account upload; customer enquiry to owning vendor quote and buyer response visibility; notification privacy; and direct attempts at checkout, order, payment, and shipment creation fail without side effects. Do not create production enquiries, quotes, reviews, uploads, payments, or notifications.
5. Verify the page left open before launch transitions at/after `2026-11-07T18:30:00.000Z` without refresh or redeployment. Do not use production writes to test the boundary.
6. Record exact HTTP statuses and sanitized evidence. Keep commerce disabled before and after launch. Stop on any failed gate, authorization, privacy, CORS, Hosting, rules, or rollback check.
7. Walk all seven legal routes from desktop and mobile layouts; confirm footer links on both Coming Soon and normal pages. Exercise customer email/password and Google registration plus vendor application using test identities, verify mandatory unchecked policy boxes, optional marketing choice, and recorded policy versions/server timestamps without exposing acceptance records to browser clients.

### Historical local validation — 2026-11-01 (superseded by the latest state at the top)

- Final revalidation: backend `npm test -- --test-concurrency=1` completed **253 tests: 249 passed, 0 failed, 4 skipped**; focused launch-gate suite completed **34 tests: 32 passed, 0 failed, 2 emulator-dependent skips**. Isolated Auth/Firestore emulator tests completed **19/19**, Hosting verifier tests **4/4**, and Hosting Emulator routing test **1/1**; all had zero failures. The skipped tests are emulator-dependent and were run separately against isolated `demo-*` projects where supported.
- A fresh temporary production build completed successfully after transforming **1,885 modules**. Hosting verification confirmed both configured sites share `dist` and all **3** local JS/CSS references exist. Firebase Hosting Emulator verified working assets and SPA deep links plus 404 for a missing `/assets/*.js`. Vite reported large chunks (main **947.99 kB**, Three.js **568.17 kB**); build succeeded. `npm run lint`, JavaScript syntax checks, and `git diff --check` passed. Temporary build/emulator directories were removed.
- Final repository state: branch `release/partswala-launch-20261021`, HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce`, **55 modified tracked paths, 45 untracked files, 0 staged paths, 0 tracked deletions**. Ignored `dist/` remained at 2026-10-31 22:35; ignored `firestore-debug.log` remained 62,227 bytes at 2026-10-31 19:44. No staging, commit, push, deployment, or Firestore publication occurred.
- Backend `npm test -- --test-concurrency=1`: **252 total, 248 passed, 0 failed, 4 emulator-dependent skips**. Four Auth/Firestore emulator suites were rerun separately with a temporary config/rules copy and `demo-partswalaind`: **31 passed, 0 failed, 0 skipped**. Boundary fixtures prove admin settlement and order-status requests and return refund-approval/reverse-pickup actions are rejected without database changes at launch time −1 ms, exactly at launch, and +1 ms.
- Local code fixes: `/api/admin/finance/order` permanently denies `action: "settle"` and `/api/admin/orders/status` denies order-status mutations before database access. The admin return endpoint also denies refund approval and reverse-pickup scheduling while the commerce lock is active. Admin order-status, COD reconciliation, shipping retry, refund, return-approval, and reverse-pickup controls are now disabled, with matching service-layer guards for prohibited operations. Finance cost reporting and non-shipping return review remain available.
- Frontend tests rerun serially after the commerce-control changes: **26 passed, 0 failed, 0 skipped**. Hosting verifier tests after the routing/cache config change: **4 passed, 0 failed, 0 skipped**. `npm run lint`, backend syntax checks, and final `git diff --check` passed.
- Root `npm audit`: **0 vulnerabilities**. Backend production audit (`npm audit --omit=dev`): **0 vulnerabilities**. The full backend audit still reports **15 moderate development-tool findings** in the `firebase-tools@15.34.2` tree: GHSA-8988-4f7v-96qf (`@opentelemetry/core`), GHSA-3g3m-2fjr-6pw4 (`glob`), GHSA-g3hv-75wg-m249 (`minimatch`), and GHSA-w5hq-g745-h8pq (`uuid`). The non-forced audit dry run proposes breaking downgrade `firebase-tools@13.11.2`; no forced change was made. Production XLSX parsing uses official SheetJS `xlsx@0.20.3`; focused parser/API suites passed **15/15**, and the full backend suite passed. `firebase-admin@14.5.0` requires Node `>=22`; local Node is `24.16.0`, while the Render runtime is unknown.
- Fresh build to a unique temporary directory passed after transforming **1,885 modules**. Hosting verification confirmed both configured sites use shared `dist` and all **3 local JS/CSS links in `index.html`** exist. Temporary build and emulator artifacts were removed; ignored `dist/` and `firestore-debug.log` were preserved. Vite still warns about large chunks: main **947.99 kB**, Three.js **568.17 kB**. Emulator output included the Firebase Admin credentials-option deprecation warning and an expected simulated Cloudinary failure log; all 31 tests passed.
- Hosting routing regression (`scripts/hostingRouting.emulator.test.js`): **1 passed, 0 failed, 0 skipped** on Firebase Hosting Emulator with a fresh temporary build and isolated demo project. It confirmed the main JS/CSS and lazy Login chunk have expected MIME types, product deep links still rewrite to the app shell, and a nonexistent asset returns 404 rather than the SPA shell. Hosting verifier tests: **4 passed, 0 failed, 0 skipped**. The emulator did not provide reliable custom cache-header evidence; cache policies are asserted from config and require post-deployment HTTP verification.
- **Read-only Hosting HTTP comparison confirms a production bundle/routing mismatch behind the reported chunk failure:** `partswalaind.com/` returned HTML referencing `index-zNSfCvEH.js`, `firebase-DneLkwbf.js`, and `index-BXIlST6V.css`; its HTML hash and references matched `partswalaflutter.web.app/`, not `partswalaind.web.app/` (which referenced `index-DoXB2Cw6.js` and `index-Dp8DPtEq.css`). The `.com` bundle references `Login-BrqCtMSN.js`; the same chunk returns **200 JavaScript** from `partswalaflutter.web.app`. On `partswalaind.com`, the reported chunk and valid/missing asset paths returned **301 to the same URL**. On `partswalaind.web.app`, the missing Login chunk returned **200 `text/html`** via the SPA fallback. Root and fallback responses used `Cache-Control: max-age=3600`. A read-only TLS handshake succeeded; the presented certificate SAN covers `partswalaind.com` and it is valid through **2027-01-02 04:17:37 UTC**. This confirms the live self-redirect, HTML fallback, and stale-reference risk, but not which Firebase site owns the custom domain or why the edge redirects. Candidate Firebase config sets no-cache and builds both sites from one `dist`; this is not deployed. The owner must confirm the custom-domain mapping and Firebase Console certificate/Hosting attachment status and resolve the redirect before any release approval.
- Read-only production checks on 2026-11-01 07:34 UTC: Render `/health` **200**; `/api/settings/public` **200/no-store**, `preLaunchEnabled` present but `launchTime`, `serverTimeUtc`, and `millisecondsUntilLaunch` absent; anonymous public catalogue and review GETs **200** without `Cache-Control`. Catalogue/review response bodies were not read or printed. These are confirmed production launch-gate blockers.
- Firebase CLI confirms project `partswalaflutter`, sites `partswalaflutter` and `partswalaind`, and distinct finalized live releases from 2026-10-21 (52 files and 61 files respectively), which accounts for independent bundles at the two `web.app` URLs. The candidate site release is version `7794259dc963f819` at `https://partswalaind.web.app`; the other is `f9785433d9ff68f6` at `https://partswalaflutter.web.app`. CLI metadata does not establish whether `partswalaind.com` maps to either site or SSL/certificate status; the owner must check Firebase Console → Hosting → each site → Custom domains. Render service identity, deployed commit, and Node runtime are also unconfirmed.
- Legal policy drafts still require owner-confirmed entity/address, grievance contact/timelines, retention/deletion/access terms, actual cookie behavior, and qualified Indian legal review. No production deployment, rules publication, DNS/settings change, or live upload/journey test occurred. The candidate is not production-ready.
- Final worktree inventory: **55 modified tracked files, 45 untracked files, 0 staged paths, 0 tracked deletions**. The pre-existing ignored `dist/` and `firestore-debug.log` were not overwritten.

### Rollback and remaining risks

- Firebase Hosting: use the confirmed site's release history to restore the last known-good reviewed bundle; verify both its `*.web.app` URL and mapped custom domain. Do not change DNS.
- Render: use the confirmed service's deploy history to restore only a previously validated secure backend. The known older backend exposes catalogue/reviews before launch and lacks `/api/vendor/access`; do not use it as a routine rollback. If no secure prior exists, stop and request an owner-approved fail-closed response.
- Firestore: restore a recorded prior rules release only with separate explicit rules-owner approval, then rerun the Auth/Firestore access matrix.
- **Payment callback integrity requires owner/provider confirmation before any future callback authorization:** callbacks are now denied without side effects while commerce is disabled. PhonePe's previous reconciliation implementation did not compare callback transaction ID/amount to an internally stored provider transaction; verify provider payload binding and define regression coverage before any separate approval to process callbacks.
- Production deployment, domain mapping, deployed rules version, live user journeys, Cloudinary, and callback provider behavior remain unverified. The candidate is **not production-ready** based on these local checks.

### November 6 follow-up — continued repair (historical checkpoint)

This checkpoint does not authorize deployment. Its counts and test results are superseded by the latest local validation at the top.

- At this checkpoint, the checkout was branch `release/partswala-launch-20261021`, HEAD `c7e889f87860b261d99aeb3e556829d71acc90ce`, with 55 modified tracked paths, 60 untracked paths, no staged paths or tracked deletions. The worktree was dirty and not an immutable deployable release. No files were staged, committed, pushed, deployed, or published to Firestore.
- Fixed a local regression in `eligiblePublicProductDocuments`: its final projection had dropped the normalized product, causing vendor-name and vendor-contact route failures after launch. The projection now retains that product. Auth/Firestore emulator coverage passed for vendor-name and vendor-contact access at the launch boundary and afterward.
- Post-fix backend `npm test`: **263 tests, 259 passed, 0 failed, 4 skipped**. Isolated Auth/Firestore emulator run: **31 tests, 31 passed, 0 failed, 0 skipped**. Earlier same-worktree frontend tests passed **33/33**, lint passed, a temporary-output build transformed **1,888 modules**, Hosting verifier tests passed **4/4**, and Hosting Emulator routing passed **1/1**. The emulator rerun and backend suite were completed after the helper fix; the frontend/build/lint/Hosting suites were not rerun because this follow-up changed only that backend projection.
- Browser check on the local Vite app at 375px verified `/checkout` renders “Online ordering is unavailable,” exposes no order form or payment button, and has no horizontal overflow. The local browser had no API mock; public settings and assistant requests logged expected unavailable/404 errors. Authenticated browser journeys were not exercised.
- Fresh GET-only production checks on November 6: `/health` returned 200; public settings returned 200/no-store with only `preLaunchEnabled` and `comingSoonVideoUrl`; public product list and detail returned 200 with product data and no cache-control; reviews returned 200 with an empty list and no cache-control; vendor-contact returned 200 with a null contact value and no cache-control. `partswalaind.web.app` root and a missing asset both returned HTML 200 with `max-age=3600`. `partswalaind.com` root and missing asset both returned 301 redirects to the same URL. No payload values were copied here.
- These live results still show the deployed backend and Hosting behavior do not match the candidate. Production is **NO-GO**. Render service identity, deployed SHA, build/start settings, Firebase custom-domain mapping, and the cause of the `.com` self-redirect remain owner-only configuration questions.
- Required owner actions remain: first identify the Render service/repository/branch/root/deployed SHA and confirm root-level commands `npm ci --prefix backend` and `npm --prefix backend start` with Node 22+; then authorize a reviewed immutable release and verify the backend GET matrix. In Firebase Console, confirm which Hosting site owns `partswalaind.com`, resolve the self-redirect, and approve the intended site release. Do not change DNS or deploy until the release owner authorizes those changes.

### November 6 blocker-only metadata check

- Read-only platform evidence at that metadata-check snapshot: the local Git origin is `github.com/harshgamerz976-alt/partswala-ind`; branch/HEAD were `release/partswala-launch-20261021` / `c7e889f87860b261d99aeb3e556829d71acc90ce`, with uncommitted changes. Local remote refs showed `origin/release/partswala-catalogue-api-20261021-fast` at the same base SHA; there was no remote ref for the local `release/partswala-launch-20261021` branch. That snapshot had 55 modified tracked paths, 62 untracked paths, 0 staged paths, and 0 tracked deletions. No Render manifest/config is present. The Render API returned 401 without a bearer token, the Render dashboard could not be opened in the available browser, and no Render CLI/API credential was available. Therefore the exact Render service ID, configured repository/branch/root, deployed SHA, runtime, and live commands cannot be truthfully reported from this environment.
- Live responses demonstrate why the API remains unsafe: catalogue list/detail, reviews, and contact routes still respond successfully before launch; public settings still has the old schema; vendor-access and assistant settings do not match the candidate. The candidate gate is only in the dirty local worktree, so it is not evidence of code running on Render. Confirm the service settings in the Render dashboard before selecting a reviewed immutable release.
- Firebase CLI confirms `partswalaind.web.app` is site `partswalaind`, and the project also has site `partswalaflutter`. `hosting:sites:get` does not report custom-domain attachments. Firebase Console redirected to Google sign-in; the local CLI session had no usable, unexpired read-only custom-domain API scope, so the `.com` attachment and `redirectTarget` remain unverified. A prior read-only bundle comparison found `.com` serving the `partswalaflutter.web.app` release while `partswalaind.web.app` served a different release; the current `.com` root still redirects to itself. Firebase's custom-domain API exposes `redirectTarget`, and its setup wizard can redirect one custom domain to another, but this evidence does not establish which setting is presently configured.
- The candidate `firebase.json` configures both sites to use `dist`, rewrites only explicit SPA route families, does not rewrite `/assets/**`, revalidates general HTML responses, and applies immutable one-year caching to `/assets/**` after the global cache rule. `scripts/verifyHostingBuild.test.js` passed **4/4** configuration/build-verifier tests; earlier Hosting Emulator routing passed **1/1**. The production missing-asset and cache responses still contradict this local configuration.
- Added `scripts/verifyProductionGet.js` and `scripts/verifyProductionGet.test.js`. The script makes GET requests only, never logs response bodies or the product ID, checks the public launch contract, protected API gates and unauthenticated private APIs, direct product-related endpoints when given a probe ID, both domains, SPA routes, asset MIME/cache policy, missing assets, and redirect loops. Run from repository root with a known product document ID in `PARTSWALA_PROBE_PRODUCT_ID`; the ID is not printed. GET-only verification cannot exercise POST behavior of the by-IDs and vendor-names handlers.
- Production run of the verifier: **3/33 checks passed** (health and the JS/CSS HTML references); the rest failed, including old settings, pre-launch public API responses, missing private-route protections, `max-age=3600`, missing-asset HTML 200, and the `.com` redirect loop. No response payload values or product IDs were logged. New verifier plus Hosting tests passed **8/8**; targeted Oxlint passed. `git diff --check` passed with the existing line-ending warning in `src/services/productService.js`.
- Remaining owner action for Render: locate the service serving `partswala-ind.onrender.com`; record service ID, repository, branch, root, deployed commit, Node version, build/start commands, and `/health` setting. For the reviewed candidate, the expected source is this GitHub repository, repository-root service, Node 22+, build `npm ci --prefix backend`, start `npm --prefix backend start`, health path `/health`. The exact branch/SHA must be one that the release owner has reviewed and published; the current dirty worktree is not deployable.
- Remaining owner action for Firebase: in project `partswalaflutter`, open Hosting → View `partswalaind` → Custom domains and inspect `partswalaind.com`, `redirectTarget`, host/SSL state; repeat under site `partswalaflutter`. Ensure the apex domain is attached only to the owner-selected site, remove any self-redirect, and configure at most a one-way redirect to the chosen canonical host. If the domain is attached to the wrong site, correct the attachment only after owner confirmation. Follow any DNS instructions shown by Firebase through the authorized DNS owner; no DNS was changed here. Then publish the same owner-approved build to the selected site and repeat the GET verifier.

### November 6 follow-up — production source and Hosting release evidence

- Firebase Hosting's read-only `hosting:channel:list` response identified the active `partswalaind` live version as `7794259dc963f819`, released **2026-10-21 10:55:33Z**. Its deployed config contains a catch-all rewrite `glob: "**" -> "/index.html"` and no `Cache-Control` header (only security headers on `glob: "**"`). This directly explains the missing-asset HTML 200 and why responses use Firebase's observed default `max-age=3600`: the deployed version is the older release, not the current local Hosting config. The other site `partswalaflutter` is also on a separate older live version (`f9785433d9ff68f6`, 2026-10-21 10:51:57Z) with the same catch-all rewrite. Neither version's Firebase release metadata provides a source commit SHA.
- Local Hosting config has now been corrected for a clean owner-approved release: each site's catch-all rewrite was already replaced by explicit app routes; cache headers now use Firebase-supported glob `source` rules (default revalidation on `**`, immutable one-year caching only for hashed asset filenames matching `/assets/**/*-????????*.*`). The broad all-assets immutable override is removed. No rule rewrites `/assets/**`, so missing assets fall through to Hosting's real 404. The config checker now rejects unhashed JS/CSS references and checks the glob-based cache policy.
- Local verification after that change: Hosting configuration/build checks plus production-verifier tests **9/9 passed**; targeted Oxlint passed. The fresh Vite build was written to a temporary directory, transformed **1,888 modules**, and passed `scripts/verifyHostingBuild.js`. Hosting Emulator route test **1/1 passed** for all explicit SPA paths, valid JS/CSS MIME types, and missing-asset 404. This emulator does not return the configured `Cache-Control` headers; those must be verified by the GET verifier after an authorized Hosting deployment.
- Current GET verifier now distinguishes actual GET endpoints from POST-only routes. GETs for `/api/public-products/by-ids` and `/api/products/vendor-names` would be method-mismatch 404s; no such production requests are sent, and local mounted-server tests verify their POST pre-launch gate. A reviews GET without required `productId` is likewise skipped. Production run on November 6: **3/30 applicable checks passed, 2 skipped**. It still fails on launch settings, catalogue/detail/reviews/vendor-contact access and missing `no-store`, missing candidate GET routes (`/api/settings/assistant/public`, `/api/vendor/access`), unauthenticated enquiry response caching, Hosting cache headers, missing-asset HTML 200, and the `.com` redirect loop. Product IDs and bodies are suppressed from output.
- Render source comparison: the published `origin/release/partswala-catalogue-api-20261021-fast` branch is at `c7e889f87860b261d99aeb3e556829d71acc90ce`; its `server.js` registers catalogue routes without the candidate pre-launch middleware/clock and its `publicSettings.js` returns the old pre-launch/video shape. This is a source-level match for the live API behavior if Render is using that branch. Render's dashboard/API remain inaccessible without service-owner credentials, so the exact deployed service, SHA, branch, root, Node version, and start command are still unverified.
- Local candidate backend enforcement was checked without edits in this follow-up: `setApiNoStore` runs before API handlers; the central gate runs before body parsing and all routes; catalogue, detail, reviews, contact, and settings handlers have launch checks; customer enquiry reads/creation are closed before launch while the approved-vendor workspace remains intentionally available. Focused gate/settings/catalogue/CORS/mounted-server tests passed **27/27**.
- The `.com` response still returns HTTP 301 with `Location` on `partswalaind.com` itself. Neither checked-in `firebase.json` nor the active site's release config contains a redirect rule, so that loop is outside the current site-version rewrite rules. Firebase Console/custom-domain metadata is still inaccessible here; do not assume the attachment site or `redirectTarget`. The owner must inspect both Hosting sites' Custom domains entries for `partswalaind.com`, its redirect target and host/SSL state, then remove a self-target or correct a wrong attachment. No DNS, settings, deployment, or production data was changed.
- Render owner correction remains: identify the service by its `onrender.com` hostname; set the repository to `harshgamerz976-alt/partswala-ind`, repository-root service (blank root), an owner-reviewed immutable branch/SHA containing the gate changes, Node 22.x, build `npm ci --prefix backend`, start `npm --prefix backend start`, health path `/health`. The local `release/partswala-launch-20261021` branch is not remote and remains dirty; the owner must publish/approve a release before configuring Render. Then redeploy only with authorization and verify `/health`, safe public settings, pre-launch 403/no-store for all GET-protected resources, customer enquiry denial, and the intended approved-vendor exception using the GET verifier.

### November 6 complete-readiness verification

- Production GET-only verification was rerun with a synthetic, non-document probe value; the value and response bodies were not logged. **2/30 applicable checks passed, 28 failed, 2 were skipped.** Render returned HTTP 503 for health, launch settings, catalogue, reviews, contact, assistant-settings, and unauthenticated enquiry/dashboard requests; these responses lacked the expected API no-store and security headers. This indicates the API is currently unavailable or returning an upstream failure, but does not identify the cause. The `.web.app` root and SPA routes still returned HTML with incorrect cache policy and no observed HSTS; a missing asset returned HTML 200. The `.com` root still failed due to the self-redirect loop. Production remains NO-GO.
- The GET verifier now checks API security headers (HSTS, nosniff, frame denial, referrer policy, permissions policy, and restrictive CSP) and Hosting security headers, cache policy, `/products` plus deep SPA routes, asset MIME/cache behavior, missing assets, API gate behavior, and redirect loops. Its unit suite passes **5/5**; Hosting build-verifier tests pass **5/5**.
- Full local backend suite: **261 tests, 257 passed, 0 failed, 4 skipped** (emulator-only tests skipped in this non-emulator run). With isolated demo Auth/Firestore emulators active, the four emulator test files passed **31/31**. Frontend tests passed **33/33**. Hosting Emulator route/MIME/missing-asset tests passed **1/1**. The production Vite build transformed **1,888 modules** and passed the Hosting build verifier in a temporary output directory. Project lint passed; `git diff --check` passed with the existing LF/CRLF warning in `src/services/productService.js`.
- The local browser rendered the disabled `/checkout` explanation and browse-parts action. At a 390px viewport there was no horizontal overflow and customer navigation remained visible. Public-settings and assistant requests failed against the unavailable local backend; this did not validate authenticated customer or vendor journeys.
- Firebase Emulator did not provide the configured `Cache-Control` response header (observed absent on its root response); therefore immutable cache and HTML revalidation must be verified by production GETs after an authorized Hosting release. No deploy, DNS update, rules publication, or production write occurred. Protected `dist/` and workspace Firestore debug logs were not modified.
