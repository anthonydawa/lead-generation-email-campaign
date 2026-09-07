const EMAIL_SHELL_OPEN =
  '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#202124;">';

export const DEFAULT_EMAIL_FOOTER_HTML = `
<div data-relay-footer="true">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:22px 0 20px;">
    <tr>
      <td style="padding:0 12px 0 0;vertical-align:middle;">
        <img
          src="https://static.wixstatic.com/media/851933_95a77dd1dfa34c848e652d4320d319b0~mv2.png/v1/fill/w_80,h_80,lg_1/851933_95a77dd1dfa34c848e652d4320d319b0~mv2.png"
          width="40"
          height="40"
          alt="AI Accounting Agency"
          style="display:block;width:40px;height:40px;border:0;">
      </td>
      <td style="vertical-align:middle;">
        <strong>Anthony</strong><br>
        <span style="color:#5f6368;">AI Accounting Agency Team</span>
      </td>
    </tr>
  </table>
  <div style="border-top:1px solid #dddddd;padding-top:12px;font-size:12px;line-height:1.45;color:#666666;">
    <p style="margin:0 0 8px;">
      <a href="https://www.aiaccountingagency.com/" style="color:#356859;text-decoration:underline;">aiaccountingagency.com</a>
      &nbsp;|&nbsp;
      <a href="https://www.linkedin.com/company/aiaccountingagency/" style="color:#356859;text-decoration:underline;">LinkedIn</a>
    </p>
    <p style="margin:0 0 8px;">
      AI Accounting Agency<br>
      Las Vegas, Nevada 89120
    </p>
    <p style="margin:0;">
      Business outreach from AI Accounting Agency. If you'd rather not receive further emails, reply "no" and I'll stop.
    </p>
  </div>
</div>`;

export function stripManagedEmailFooter(value: string) {
  let html = value.trim();
  if (!html) return "";

  const managedFooterIndex = html.search(
    /<div\b[^>]*data-relay-footer=["']true["'][^>]*>/i,
  );
  if (managedFooterIndex >= 0) {
    html = html.slice(0, managedFooterIndex);
  } else {
    const signatureTableIndex = html.search(
      /<table\b[^>]*role=["']presentation["'][^>]*>/i,
    );
    if (
      signatureTableIndex >= 0 &&
      /AI Accounting Agency/i.test(html.slice(signatureTableIndex)) &&
      /(Business outreach|reply\s+[“"']?no)/i.test(
        html.slice(signatureTableIndex),
      )
    ) {
      html = html.slice(0, signatureTableIndex);
    } else {
      const signoffIndex = html.search(
        /<p\b[^>]*>\s*(?:Best|Regards),?\s*<br\s*\/?>\s*Anthony\b/i,
      );
      if (
        signoffIndex >= 0 &&
        /(AI Accounting Agency|reply\s+[“"']?no)/i.test(
          html.slice(signoffIndex),
        )
      ) {
        html = html.slice(0, signoffIndex);
      }
    }
  }

  html = html.replace(
    /^\s*<div\b[^>]*style=["'][^"']*max-width\s*:\s*600px[^"']*["'][^>]*>/i,
    "",
  );
  return html.replace(/(?:<br\s*\/?>|\s)+$/gi, "").trim();
}

export function ensureDefaultEmailFooter(value: string) {
  const message = stripManagedEmailFooter(value);
  return `${EMAIL_SHELL_OPEN}\n${message}\n${DEFAULT_EMAIL_FOOTER_HTML}\n</div>`;
}

export function personalizeEmailHtml(
  value: string,
  recipient: { firstName?: string | null; company?: string | null },
) {
  return value
    .replaceAll("{{first_name}}", recipient.firstName?.trim() || "Jordan")
    .replaceAll("{{company}}", recipient.company?.trim() || "Acme Company");
}
