# Multi-user Baileys home-chat mode

## Product contract

Each BizzClaw tenant links one WhatsApp account through Linked Devices and then
chooses exactly one home destination during onboarding:

- **Message yourself** (recommended): no group or second person is required.
  Normal messages are accepted without an `@bizzclaw` mention.
- **One verified group**: members use `@bizzclaw` to open a conversation;
  follow-ups remain natural during a 30-minute idle window.

Every reply and scheduled result returns only to that saved destination.

Baileys uses the unofficial WhatsApp Web protocol. This path is suitable for a
controlled MVP and real-device validation, but it does not remove WhatsApp
account restrictions or replace an official production WhatsApp API.

## Isolation model

- The process owns one `BaileysSession` per tenant `clientId`.
- Credentials are isolated at `store/clients/<clientId>/auth/` and are never
  returned to the browser or written to logs.
- QR, linked, and logout events are sent only to the onboarding session that
  started that tenant's socket. Background sessions never broadcast QR data.
- Pairing codes are available for same-phone mobile onboarding. The submitted
  number and returned code stay in memory only, are never logged or added to
  analytics, and code requests are rate-limited per onboarding session.
- The selected destination is stored in tenant `meta.json` as
  `baileysHomeChatJid` + `baileysHomeChatKind`. Legacy group fields remain
  readable during migration.
- The Message yourself JID is normalized from the connected socket owner. The
  browser submits neither a phone number nor a JID, so it cannot authorize a
  different person's direct chat.
- Inbound messages fail closed unless they come from the saved self-chat or
  group. Every other direct chat and group is ignored.
- Active-conversation state is process-local, scoped to the tenant socket and
  selected group, and expires after `BAILEYS_CONVERSATION_TTL_MS` of inactivity
  (30 minutes by default). Restart and expiry both require a fresh mention.
- The tenant id is passed separately from the group JID when building the agent,
  preventing a group address from loading another or empty business profile.
- The Baileys transport checks the saved home destination again before every
  text or media send. Another direct chat or group is rejected even for
  scheduled work.
- Messages typed by the linked account owner on their primary phone remain
  usable. Message ids created by the agent socket are tracked and ignored to
  prevent reply loops without discarding every Baileys `fromMe` message.
- On restart, the manager discovers each tenant with persisted `creds.json` and
  restores sockets independently. One revoked account does not block others.
- The authenticated dashboard can request an on-demand hand-off to the saved
  home group. The server verifies that the linked account still participates in
  the saved group, asks WhatsApp for its invite URL, and returns it only to that
  signed-in tenant. The browser never supplies a group JID.

## Dashboard WhatsApp entry

For Message yourself, the dashboard opens `wa.me/<linked-owner>` directly. For a
selected group, the primary action remains **Open my BizzClaw group**. WhatsApp
does not provide a supported deep link for an internal group JID, so the server
requests the group's invite URL only after the user clicks. The URL is not
persisted or placed in page HTML.

## Message yourself acceptance test

1. Link a test WhatsApp account and select **Message myself**.
2. Open WhatsApp's Message yourself chat and send `plan my next three tasks`
   without an `@bizzclaw` mention. Confirm the agent replies in that same chat.
3. Send an attachment and confirm the result returns to the self-chat.
4. Create a scheduled reminder and confirm it returns to the self-chat.
5. Send `@bizzclaw hi` from any other direct chat or group and confirm the agent
   does not read or reply.

Creating a new group is never automatic. The Launch screen and the dashboard's
**Change or create group** link offer an explicit creation form. WhatsApp needs
one other participant at creation, so the user supplies one phone number with a
country code and confirms the exact group name and invitee before the request is
sent. The onboarding endpoint converts the number to a WhatsApp JID in memory
and does not persist the submitted form field; WhatsApp still records group
membership normally. The returned group becomes that tenant's home group.
The browser disables the submitting control and the server never retries a group
creation request blindly.

Inside the optional new-group flow, the default membership choice is **Only
me**. After WhatsApp creates the group,
the linked socket requests removal of the temporary setup contact. The API
reports the removal result rather than assuming success. If WhatsApp does not
confirm removal, onboarding stays on the WhatsApp step and tells the owner to
remove that person manually before sharing private work. Users can instead
choose **Me and this person** to keep a shared workspace intentionally.

“Only me” is a human-membership boundary, not a promise that WhatsApp is absent.
WhatsApp still transports the end-to-end encrypted conversation, and the linked
BizzClaw device/service can read message content because that access is required
to run and answer the agent.

## Two-device acceptance test

Use two test WhatsApp accounts and two separate BizzClaw tenants. Avoid a
business-critical WhatsApp number while this MVP uses Baileys.

### Same-phone mobile linking

On a phone, onboarding defaults to **Use this phone**:

1. Enter the WhatsApp number with its country code and request a linking code.
2. Open WhatsApp, open **Linked devices**, and choose **Link a device**.
3. Choose **Link with phone number instead** and enter the code shown by
   BizzClaw.
4. Return to onboarding. The existing SSE connection detects verification and
   opens group selection automatically.

The exact placement of **Linked devices** differs slightly between iPhone and
Android. QR linking remains available under **Scan QR** when the onboarding page
is open on a second screen.

For a local test, start the purpose-built harness:

```bash
npm run test:baileys:devices
```

It builds the real onboarding frontend, creates two isolated tenants, and prints
two onboarding URLs. Open each URL in a separate browser profile. To open the
pages from other devices on the same Wi-Fi, use
`BAILEYS_DEVICE_TEST_HOST=0.0.0.0 npm run test:baileys:devices` and use one of the
LAN URLs it prints. The harness refuses `NODE_ENV=production` and stores its
state separately under the operating system's temporary directory by default.

1. Start the full application with `WHATSAPP_PROVIDER=baileys`,
   `BAILEYS_GROUP_ONLY=true`, and `BAILEYS_REQUIRE_TRIGGER=true`.
2. In browser profile A, complete onboarding and scan its QR with WhatsApp
   account A. Choose **Message myself**.
3. In a separate browser profile or device, complete onboarding for tenant B,
   scan with WhatsApp account B, and choose group B.
4. In account A's Message yourself chat, send `summarize my next three
   priorities` without a mention. Confirm only tenant A's agent replies there.
5. Repeat in group B and confirm only tenant B's agent and business context are
   used.
6. Send the trigger in an unselected group and a different direct chat. Confirm there
   is no read/reply from BizzClaw.
7. Create a scheduled task in A's self-chat and B's selected group. Confirm each
   result returns only to its tenant's saved home destination.
8. Restart the server without reopening onboarding. Repeat steps 4 and 5 to
   confirm both persisted sessions restore.
9. Disconnect tenant A from onboarding. Confirm A stops while tenant B remains
   connected and responsive.

## Automated verification

Run:

```bash
npm run type-check
npm test
npm run build:frontend
```

The focused tests cover concurrent session creation, per-client restart
restoration, owner-derived self-chat selection, home-chat inbound and outbound
gating, explicit tenant identity for delivery, and prevention of fallback to
another WhatsApp sender.
