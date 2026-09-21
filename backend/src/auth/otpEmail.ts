import { EMAIL_COLORS, escapeHtml, renderEmail } from "../email/layout";
import { EmailMessage } from "./EmailSender";

export function buildOtpEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const c = EMAIL_COLORS;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;line-height:30px;font-weight:700;color:${c.ink};">Your sign-in code</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:24px;">Enter this code to sign in to SeatLock. It expires in ${ttlMinutes} minutes.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="background:${c.surface};border:1px solid ${c.border};border-radius:12px;padding:22px 12px;">
          <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;color:${c.ink};">${escapeHtml(code)}</span>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:${c.muted};">
      If you didn't try to sign in, you can safely ignore this email. Never share this code with anyone &mdash; SeatLock will never ask you for it.
    </p>`;

  return {
    to,
    subject: "Your SeatLock sign-in code",
    text: [
      `Your sign-in code is ${code}. It expires in ${ttlMinutes} minutes.`,
      "",
      "If you didn't try to sign in, you can safely ignore this email. Never share this code with anyone.",
    ].join("\n"),
    html: renderEmail({
      title: "Your SeatLock sign-in code",
      preheader: `Your sign-in code is ${code}. It expires in ${ttlMinutes} minutes.`,
      bodyHtml,
    }),
  };
}
