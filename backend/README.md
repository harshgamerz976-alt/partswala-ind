# Backend Operations

## Admin claims

Run claim changes only from a trusted environment with the Firebase Admin service-account variables configured:

```sh
npm run admin:claim -- admin@example.com grant
npm run admin:claim -- admin@example.com revoke
```

The account must have a verified email. The command revokes existing refresh tokens; the user must sign in again to receive the updated claim.

## Vendor product privacy cleanup

The product privacy migration scans in pages and defaults to a dry run:

```sh
node migrations/removeVendorProductPrivateFields.js
node migrations/removeVendorProductPrivateFields.js --apply
```

Review the dry-run count before using `--apply` with production credentials. It deletes only `vendorAddress`, `vendorGstin`, and `vendorState` fields from public product documents; private vendor profiles remain the source for future checkout invoice/tax snapshots.

## WhatsApp Cloud API webhook

Configure these server-only environment variables in Render:

- `WHATSAPP_VERIFY_TOKEN`: a strong, private value that you choose and enter in both Render and Meta's webhook verification form.
- `META_APP_SECRET`: the App Secret from the Meta app connected to the WhatsApp Business account. Never expose it in frontend variables or logs.
- `WHATSAPP_ACCESS_TOKEN`: a server-only WhatsApp Cloud API access token with permission to send messages from the connected number.
- `WHATSAPP_PHONE_NUMBER_ID`: the connected WhatsApp Business phone-number ID; incoming events for other numbers are ignored.
- `WHATSAPP_GRAPH_API_VERSION`: optional Graph API version, default `v22.0`.
- `WHATSAPP_TEAM_USER_IDS`: comma-separated Firebase Auth UIDs for team members. Each recipient is checked for an admin claim or approved admin email before receiving a generic notification. Keep this list limited to authorized staff.

The backend uses the existing Gemini/Groq server-side keys (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, and `GROQ_MODEL`) to interpret natural-language questions, extract only customer-provided vehicle/part/quantity details, and route store-policy questions to the existing server-side store settings. If AI is unavailable, the bot falls back to safe message-only extraction and continues asking for missing details. It never uses model-generated pricing, availability, fitment, vendor confirmations, checkout, or payment claims. Enquiries are quote requests only and remain subject to the marketplace launch gate.

In the Meta app's WhatsApp > Configuration webhook settings, use callback URL `https://partswala-ind.onrender.com/api/webhooks/whatsapp`, enter the same `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field. The endpoint verifies `X-Hub-Signature-256` against the exact raw request body using `META_APP_SECRET`. Delivery events are deduplicated in `whatsappWebhookEvents`. A limited recent conversation history, the matched WhatsApp profile display name when provided by Meta, and structured quote requests are stored in server-only `whatsappConversations` and `whatsappEnquiries`; Firestore rules deny client access. The bounded profile display name is also passed in a separate context to the configured AI provider for conversational use. Profile names are unverified display names, not legal identity, and are omitted from ordinary webhook event metadata. Only authenticated backend admin routes can list enquiries, inspect a conversation, or switch its `mode` between `human` and `bot`. Customer phone numbers and message contents must not be written to ordinary logs.

The bot sends free-form replies only in response to a customer message and only within WhatsApp's 24-hour customer-service window. It does not send templates or promotional messages. `HUMAN`/`AGENT` requests pause automation and notify authorized team accounts; `START` resumes it. `HELP` explains the quote-request details. Authorized staff can use `GET /api/admin/whatsapp/enquiries`, `GET /api/admin/whatsapp/conversations/:conversationId`, and `PATCH /api/admin/whatsapp/conversations/:conversationId` (`{"mode":"human"}` or `{"mode":"bot"}`) with Firebase Bearer authentication. To receive push notifications as well as an in-app notification record, configure the existing `FCM_PUSH_ENABLED=true` setting and an FCM token for an authorized team account.

## Local WhatsApp chat simulator

The development UI is available at `http://localhost:5173/__dev/whatsapp` when running Vite locally. Start the backend with `WHATSAPP_SIMULATOR_ENABLED=true` and `NODE_ENV=development`; for example, in PowerShell:

```powershell
$env:NODE_ENV = "development"
$env:WHATSAPP_SIMULATOR_ENABLED = "true"
npm run dev
```

The backend simulator endpoints are registered only when enabled and never in production, and additionally reject non-loopback connections. Simulated conversations and enquiries exist only in process memory and disappear when the backend restarts. The simulator invokes the same message/conversation processor as the webhook but uses a local fake sender; it cannot call Meta's WhatsApp API or send team notifications. AI interpretation still uses the configured Gemini/Groq backend keys. Store-setting lookups are deliberately not connected to Firestore in the simulator.

Deployment steps:

1. Add the required server-side variables to the existing Render backend service without changing other settings.
2. Deploy the backend release containing `backend/whatsappWebhook.js` and verify the service is healthy.
3. Configure the callback URL and matching verification token in Meta, then subscribe to `messages`.
4. Send Meta's test webhook and confirm the callback verification succeeds. Check only event metadata/counts; do not log message contents, customer phone numbers, access tokens, or secrets.