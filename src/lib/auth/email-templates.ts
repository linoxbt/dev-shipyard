// The emails Supabase sends for DevStation, in DevStation Labs colours.
//
// Supabase keeps its email templates in the project's dashboard, not in this
// repository: `bun scripts/email-templates.ts` writes these to
// supabase/templates/, and supabase/README.md says where each one is pasted.
// The `{{ .Token }}` style fields are Supabase's (Go templates), filled in when
// the email is sent.
//
// Email clients ignore stylesheets and most modern CSS, so everything is
// tables and inline styles, light only, and the logo is an image the
// deployment serves itself.

export interface EmailTemplate {
  /** Supabase's name for the template, as the dashboard lists it. */
  name: string;
  /** File name under supabase/templates/ (Supabase CLI's names). */
  file: string;
  subject: string;
  html: string;
}

const C = {
  page: "#f6f5f2",
  card: "#ffffff",
  border: "#e8e5df",
  text: "#1f2328",
  muted: "#5f6670",
  faint: "#8b9098",
  amber: "#e67e22",
  amberDeep: "#d35400",
  codeBg: "#fdf4ea",
  codeBorder: "#f3dcc2",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

function codeBlock(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
                <tr>
                  <td align="center" style="background:${C.codeBg};border:1px solid ${C.codeBorder};border-radius:14px;padding:22px 12px;">
                    <span style="font-family:${MONO};font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;color:${C.text};">{{ .Token }}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.faint};text-align:center;">It works once and expires in an hour.</p>`;
}

function button(label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 8px;">
                <tr>
                  <td align="center" bgcolor="${C.amber}" style="border-radius:999px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint};text-align:center;">Button not working? Paste this into your browser:<br /><a href="{{ .ConfirmationURL }}" style="color:${C.amberDeep};word-break:break-all;">{{ .ConfirmationURL }}</a></p>`;
}

function layout(o: {
  preheader: string;
  heading: string;
  intro: string;
  action: string;
  footnote: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>DevStation</title>
  </head>
  <body style="margin:0;padding:0;background:${C.page};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${o.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;">
                      <img src="{{ .SiteURL }}/icon-192.png" width="36" height="36" alt="DevStation" style="display:block;border:0;border-radius:9px;" />
                    </td>
                    <td style="vertical-align:middle;font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:-0.2px;color:${C.text};">
                      Dev<span style="color:${C.amber};">Station</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${C.card};border:1px solid ${C.border};border-radius:20px;padding:36px 32px;">
                <h1 style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${C.text};text-align:center;">${o.heading}</h1>
                <p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.muted};text-align:center;">${o.intro}</p>
              ${o.action}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 12px 0;font-family:${FONT};font-size:12px;line-height:19px;color:${C.faint};text-align:center;">
                ${o.footnote}
                <br /><br />
                <a href="{{ .SiteURL }}" style="color:${C.text};font-weight:600;text-decoration:none;">DevStation Labs</a>
                &nbsp;·&nbsp; Build apps by talking to an agent
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const NOT_YOU =
  "Sent to {{ .Email }}. If you did not ask for this, you can ignore it: nothing happens without the code.";

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    name: "Confirm signup",
    file: "confirmation.html",
    subject: "Your DevStation code",
    html: layout({
      preheader: "Your code to finish creating your DevStation account.",
      heading: "Welcome to DevStation",
      intro: "Enter this code in DevStation to confirm your email and finish making your account.",
      action: codeBlock(),
      footnote: NOT_YOU,
    }),
  },
  {
    name: "Magic Link",
    file: "magic_link.html",
    subject: "Your DevStation sign-in code",
    html: layout({
      preheader: "Your code to sign in to DevStation.",
      heading: "Your sign-in code",
      intro: "Enter this code in DevStation to sign in.",
      action: codeBlock(),
      footnote: NOT_YOU,
    }),
  },
  {
    name: "Invite user",
    file: "invite.html",
    subject: "You are invited to DevStation",
    html: layout({
      preheader: "You have been invited to build on DevStation.",
      heading: "You are invited",
      intro: "Someone has invited you to DevStation, where you build apps by talking to an agent.",
      action: button("Accept the invite"),
      footnote: "Sent to {{ .Email }}. Not expecting an invite? You can ignore this email.",
    }),
  },
  {
    name: "Change Email Address",
    file: "email_change.html",
    subject: "Confirm your new DevStation email",
    html: layout({
      preheader: "Confirm the new email address for your DevStation account.",
      heading: "Confirm your new email",
      intro:
        "Your DevStation account is moving from {{ .Email }} to {{ .NewEmail }}. Confirm it to finish.",
      action: button("Confirm new email"),
      footnote: "Did not ask for this? Ignore this email and your address stays as it is.",
    }),
  },
];
