# Supabase setup for DevStation

DevStation signs people in with no password, using Supabase only: they enter
their email, Supabase emails them a one-time code, and they type it in. The
first code makes the account, and every later one signs them in.

## Email templates

Supabase keeps its email templates in the project's dashboard. Under
**Authentication → Emails → Templates**, open each template below, set its
subject, switch the body to source (HTML) and replace it with the whole file:

| Template             | Subject                           | Body                          |
| -------------------- | --------------------------------- | ----------------------------- |
| Confirm signup       | Your DevStation code              | `templates/confirmation.html` |
| Magic Link           | Your DevStation sign-in code      | `templates/magic_link.html`   |
| Invite user          | You are invited to DevStation     | `templates/invite.html`       |
| Change Email Address | Confirm your new DevStation email | `templates/email_change.html` |

The first two carry the code (`{{ .Token }}`): Confirm signup goes to a new
address, Magic Link to a known one. Supabase's default versions of those two
send a link instead, which the app does not use.

To change the emails, edit `src/lib/auth/email-templates.ts` and run
`bun scripts/email-templates.ts`; a unit test fails if the files here fall out
of step.

## Limits of Supabase's built-in email

Until the project has custom SMTP, Supabase's built-in sender only delivers to
members of the project's Supabase organization (others get
`email_address_not_authorized`) and sends a few emails an hour for the whole
project (`over_email_send_rate_limit`). The app explains either one in plain
words. Custom SMTP (Authentication → Emails → SMTP Settings) lifts both.
