# Supabase setup for DevStation

DevStation signs people in with no password: they enter their email, we send a
one-time code, and they type it in. The first code makes the account, and
every later one signs them in.

## 1. Email sign-in settings

In the Supabase dashboard, under **Authentication**:

- **Sign In / Providers → Email**: Email provider on, **Confirm email** on,
  **Email OTP Length** `6` (the emails are designed for six digits; the app
  accepts 6 to 10), **Email OTP Expiration** `3600` seconds (the emails say
  "expires in an hour").
- **Sign In / Providers → User Signups**: **Allow new users to sign up** on.
- **URL Configuration → Site URL**: the deployment's address with no trailing
  slash, for example `https://devstation-omega.vercel.app`. The emails load
  the logo from `{Site URL}/icon-192.png` and link back there.
- **Emails → SMTP Settings**: a custom SMTP sender (Resend, Postmark, Amazon
  SES…). Supabase's own sender allows only a few emails an hour.
- **Rate Limits**: raise the email limit once custom SMTP is on.

## 2. Email templates

Under **Authentication → Emails → Templates**, open each template below, set
its subject, and replace its body with the whole file. Make sure **Message
body** is in source (HTML) mode when pasting.

| Template             | Subject                           | Body                          |
| -------------------- | --------------------------------- | ----------------------------- |
| Confirm signup       | Your DevStation code              | `templates/confirmation.html` |
| Magic Link           | Your DevStation sign-in code      | `templates/magic_link.html`   |
| Invite user          | You are invited to DevStation     | `templates/invite.html`       |
| Change Email Address | Confirm your new DevStation email | `templates/email_change.html` |

The first two must contain `{{ .Token }}`: that is the code. If they still
contain Supabase's default `{{ .ConfirmationURL }}` link, people get a link
the app no longer uses instead of a code. Reset Password and Reauthentication
are not used (there are no passwords) and can stay as they are.

The templates are generated from `src/lib/auth/email-templates.ts`. To change
them, edit that file and run `bun scripts/email-templates.ts`; a unit test
fails if the files here fall out of step.
