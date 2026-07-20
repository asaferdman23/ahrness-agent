# Multi-user Baileys group mode

## Product contract

Each BizzClaw tenant links one WhatsApp account through Linked Devices and then
chooses one group during onboarding. The agent accepts requests and sends every
reply or scheduled result only in that group. Group members address it with
`@bizzclaw` so normal group conversation does not trigger the agent.

Baileys uses the unofficial WhatsApp Web protocol. This path is suitable for a
controlled MVP and real-device validation, but it does not remove WhatsApp
account restrictions or replace an official production WhatsApp API.

## Isolation model

- The process owns one `BaileysSession` per tenant `clientId`.
- Credentials are isolated at `store/clients/<clientId>/auth/` and are never
  returned to the browser or written to logs.
- QR, linked, and logout events are sent only to the onboarding session that
  started that tenant's socket. Background sessions never broadcast QR data.
- The selected group JID is stored in the tenant's `meta.json` as
  `baileysHomeGroupJid`.
- Inbound messages fail closed unless they come from that group and include the
  BizzClaw trigger.
- The tenant id is passed separately from the group JID when building the agent,
  preventing a group address from loading another or empty business profile.
- The Baileys transport checks the selected group again before every text or
  media send. A direct chat or second group is rejected even for scheduled work.
- Messages typed by the linked account owner on their primary phone remain
  usable. Message ids created by the agent socket are tracked and ignored to
  prevent reply loops without discarding every Baileys `fromMe` message.
- On restart, the manager discovers each tenant with persisted `creds.json` and
  restores sockets independently. One revoked account does not block others.

## Two-device acceptance test

Use two test WhatsApp accounts and two separate BizzClaw tenants. Avoid a
business-critical WhatsApp number while this MVP uses Baileys.

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
   account A. Choose group A.
3. In a separate browser profile or device, complete onboarding for tenant B,
   scan with WhatsApp account B, and choose group B.
4. In group A, send `@bizzclaw summarize our next three priorities` from the
   linked owner's phone. Confirm only tenant A's agent replies in group A. Then
   repeat from a different group member.
5. Repeat in group B and confirm only tenant B's agent and business context are
   used.
6. Send the trigger in an unselected group and in a direct chat. Confirm there
   is no read/reply from BizzClaw.
7. Create a scheduled task from each selected group. Confirm each result returns
   only to the group where that tenant created it.
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
restoration, group-only inbound gating, group-only outbound text/media, explicit
tenant identity for group delivery, and prevention of fallback to another
WhatsApp sender.
