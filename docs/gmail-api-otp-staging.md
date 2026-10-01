# Gmail API delivery for staging OTP

This transport preserves Google identity verification → emailed OTP → OTP verification → session creation. Password reset still requires its purpose-scoped OTP and increments `sessionVersion` when the password changes. Authentication routes and the existing email templates are unchanged.

## Configuration after approval

Set these variables on the **staging web service only**, after code review and sender authorization. Nothing in this document authorizes a production change.

| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `gmail-api` |
| `GMAIL_SENDER_EMAIL` | The Gmail mailbox authorized to send, or a configured send-as alias |
| `GMAIL_OAUTH_CLIENT_ID` | Dedicated mail-sender OAuth client ID ending in `.apps.googleusercontent.com` |
| `GMAIL_OAUTH_CLIENT_SECRET` | That client's secret |
| `GMAIL_OAUTH_REFRESH_TOKEN` | Offline refresh token granted only `https://www.googleapis.com/auth/gmail.send` |

Keep credentials exclusively in server secret configuration. Never prefix them with `NEXT_PUBLIC_`, add them to `next.config`'s `env`, commit them, or log them. The existing `NEXT_PUBLIC_GOOGLE_CLIENT_ID` remains the sign-in client; sender authorization is independent of students' Google sign-in.

Resend must remain unselected. Do not supply a Resend sender/domain or enable `EMAIL_PROVIDER=resend`. A dormant key does not override explicit `gmail-api` selection; remove the existing staging Resend key when the later configuration change is authorized. SMTP credentials are not used by this provider. Unsetting `EMAIL_PROVIDER` is insufficient because production preflight requires explicit selection.

`scripts/preflight.ts` already calls the common provider-aware resolver. It now validates all four Gmail fields when Gmail API is selected, without token exchange or mail delivery. Configuration validation does not prove token validity, sender authorization, consent publishing status, or actual delivery.

## One-time sender authorization

These are future operator steps, not changes performed by the implementation task:

1. Enable Gmail API in a dedicated Google Cloud mail-sender project. Configure OAuth consent for the sender and a dedicated Web application OAuth client. Use a registered loopback callback such as `http://localhost:8765/oauth2/callback` for a trusted local authorization tool. Keep the existing application sign-in client/settings unchanged.
2. Use a trusted local OAuth tool with a loopback callback, keeping the client secret and token exchange on the local server. With the existing `google-auth-library`, construct an `OAuth2Client(clientId, clientSecret, redirectUri)` and generate the authorization URL with `scope: ['https://www.googleapis.com/auth/gmail.send']`, `access_type: 'offline'`, `prompt: 'consent'`, `include_granted_scopes: false`, and a cryptographically random `state`. Validate that state on the callback. Do not request full-mail, read, modify, or OpenID scopes for this sender client.
3. Open that authorization URL and sign in as the **sender mailbox**. Only the public client ID and authorization parameters enter the browser; the client secret and resulting tokens stay in the local server process. Students/Teachers are recipients and do not grant mailbox permissions.
4. Exchange the callback's authorization code server-side using `OAuth2Client.getToken(code)` over HTTPS. Confirm the returned scope is exactly `gmail.send` and that a refresh token is present. If an older grant omitted offline access, repeat consent for the dedicated sender client. Never print the token response or put it in a browser page.
5. Store the refresh token directly in a secure local credential store or staging secret configuration during the separately authorized setup. Set `GMAIL_SENDER_EMAIL` to the authorized sender. A different From address requires a preconfigured Gmail send-as alias.
6. Resolve the consent application's publishing/verification requirements before relying on unattended delivery. External apps in **Testing** issue refresh tokens that expire after seven days for Gmail scopes. Gmail send is a sensitive scope. Publishing is not a guarantee against revocation, sender password changes, or other refresh-token expiry conditions.

References: [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Transport and failure behavior

The server-only module performs one bounded HTTPS refresh request to `https://oauth2.googleapis.com/token`, validates the access credentials and exact send-only scope, and uses Nodemailer's existing MIME composer to encode the existing HTML message as base64url. It then makes one HTTPS POST to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`. Each request has a ten-second timeout, no caching, and rejects redirects. No SMTP connection, durable access-token cache, automatic retry, or alternate-provider fallback occurs.

Token and provider response bodies and network exception details are excluded from errors. Delivery returns false on refresh, send, or malformed-response failure. Google login removes the unusable OTP and returns delivery failure; forgot-password retains its generic public response to prevent account enumeration.

## Live acceptance after separate approval

- Deploy the reviewed commit to staging and configure the authorized sender credentials there; verify preflight before sending.
- Send one controlled OTP to the Google-verified recipient and confirm the existing message arrives in that same inbox. Confirm that Google verification alone creates no session and that entering the OTP completes login.
- Verify wrong, expired, purpose-mismatched, and replayed codes fail. Confirm delivery failure creates no authenticated session.
- Verify forgot-password delivery, generic responses for existing/unknown accounts, and successful reset. Confirm an old signed session becomes invalid after the reset.
- Verify Resend remains unselected, SMTP is never contacted, and server/browser logs and client bundles contain no Gmail credentials or tokens.
