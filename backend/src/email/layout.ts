import { config } from "../config";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
}

export const EMAIL_FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const EMAIL_COLORS = {
  accent: "#e11d2e",
  ink: "#0c0c10",
  text: "#33333b",
  muted: "#6b6b76",
  border: "#e8e8ee",
  surface: "#f7f7f9",
  page: "#f4f4f7",
  success: "#17835a",
  successBg: "#e7f8f0",
};

export function emailButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td align="center" style="background:${EMAIL_COLORS.accent};border-radius:10px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 30px;font-family:${EMAIL_FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

// Table-based layout with inline styles: the only markup that renders
// consistently across Gmail, Outlook and Apple Mail (none of them fully
// support <style> blocks, flexbox or grid in email).
export function renderEmail(options: { title: string; preheader: string; bodyHtml: string }): string {
  const c = EMAIL_COLORS;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${c.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
          <tr>
            <td align="left" style="padding:0 4px 18px;font-family:${EMAIL_FONT};font-size:22px;font-weight:800;letter-spacing:-0.3px;color:${c.accent};">SeatLock</td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid ${c.border};border-top:4px solid ${c.accent};border-radius:14px;padding:36px 32px;font-family:${EMAIL_FONT};color:${c.text};">
              ${options.bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 0;font-family:${EMAIL_FONT};font-size:12px;line-height:18px;color:${c.muted};">
              <a href="${escapeHtml(config.frontendOrigin)}" style="color:${c.muted};text-decoration:underline;">SeatLock</a> &middot; Pick a seat. Hold it. Pay securely.<br>
              This is an automated message, so please don't reply to it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
