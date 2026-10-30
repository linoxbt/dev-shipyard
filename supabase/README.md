# Supabase setup for DevStation

DevStation signs people in with no password: they enter their email, we email
a one-time code, and they type it in. The first code makes the account, and
every later one signs them in.

## How the code email is sent

The app calls our edge function `send-code` (`functions/send-code/`). It asks
Supabase for a code (`auth.admin.generateLink`, which sends nothing), then
sends the DevStation Labs email itself through [Resend](https://resend.com).
So Supabase's dashboard email templates, SMTP settings and Site URL play no
part in sign-in. Requests are rate limited in the database
(`migrations/20261030170000_sign_in_code_rate_limit.sql`): one code a minute
and six an hour per address, thirty an hour per IP.

The function's secrets (Supabase > Edge Functions > Secrets):

| Secret           | Needed  | What                                                                                                                                                                    |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | yes     | A Resend API key with sending access. Without it sign-in says emails are not set up.                                                                                    |
| `EMAIL_FROM`     | for all | The sender, on a domain verified in Resend, e.g. `DevStation <no-reply@yourdomain.com>`. Until set it is Resend's test sender, which only delivers to your own address. |
| `SITE_URL`       | no      | Where the logo and links point. Default `https://devstation-omega.vercel.app`.                                                                                          |

To change the emails, edit `src/lib/auth/email-templates.ts`, run
`bun scripts/email-templates.ts`, and redeploy the function. A unit test fails
if the generated files fall out of step.

## Emails Supabase still sends itself

An invite or a change of email (from the dashboard) still uses Supabase's own
templates. Branded versions are in `templates/` (`invite.html`,
`email_change.html`) for pasting under Authentication > Emails > Templates if
you use those.
