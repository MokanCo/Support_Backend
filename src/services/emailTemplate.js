/**
 * Branded HTML email layout (Moka&Co) — table-based for client compatibility.
 * Gradient accent + button match app primary-700 → primary-500.
 */

/** @type {readonly [string, string, string]} */
export const GRADIENT_STOPS = ['#69422d', '#7f5337', '#9b6b46'];

const TEXT_BLACK = '#1a1a1a';
const TEXT_MUTED = '#4b5563';
const SURFACE = '#fffbf7';
const PAGE_BG = '#faf5ef';

function getAssetsBase() {
  const base = (
    process.env.EMAIL_ASSETS_URL
    || process.env.APP_URL
    || process.env.FRONTEND_URL
    || ''
  ).replace(/\/$/, '');
  return base;
}

export function brandLogoUrl() {
  const base = getAssetsBase();
  return base ? `${base}/brand-logo.png` : '';
}

export function coffeeBeansBgUrl() {
  const base = getAssetsBase();
  return base ? `${base}/coffee-beans.svg` : '';
}

const FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * @param {{ label: string; href: string }} opts
 */
export function renderGradientButton({ label, href }) {
  const [c1, c2, c3] = GRADIENT_STOPS;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 20px;">
  <tr>
    <td align="left" style="border-radius:12px;background:${c2};background-image:linear-gradient(90deg,${c1} 0%,${c2} 48%,${c3} 100%);">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="18%" strokecolor="${c2}" fillcolor="${c2}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:13px 32px;color:#ffffff !important;text-decoration:none;border-radius:12px;font-weight:600;font-family:${FONT};font-size:15px;line-height:1.2;mso-hide:all;">
        ${label}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/**
 * @param {string} href
 * @param {string} [linkColor]
 */
export function renderLinkFallback(href, linkColor = GRADIENT_STOPS[1]) {
  return `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${TEXT_MUTED};font-family:${FONT};">
  Or open this link: <a href="${href}" style="color:${linkColor};text-decoration:underline;">${href}</a>
</p>`;
}

/**
 * @param {string} label
 * @param {string} valueHtml escaped HTML value
 */
export function renderDetailRow(label, valueHtml) {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${TEXT_BLACK};font-family:${FONT};">
  <strong style="color:${TEXT_BLACK};">${label}</strong><br>
  <span style="color:${TEXT_BLACK};">${valueHtml}</span>
</p>`;
}

/**
 * @param {string} commentHtml escaped
 */
export function renderCommentQuote(commentHtml) {
  const [, c2] = GRADIENT_STOPS;
  return `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${TEXT_MUTED};font-family:${FONT};">Comment</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:${TEXT_BLACK};white-space:pre-wrap;font-family:${FONT};padding:12px 14px;border-left:4px solid ${c2};background:${SURFACE};border-radius:0 8px 8px 0;">${commentHtml}</p>`;
}

/**
 * Wrap email body HTML in branded shell.
 * @param {{ bodyHtml: string; preheader?: string }} opts
 */
export function renderBrandedEmail({ bodyHtml, preheader = '' }) {
  const [c1, c2, c3] = GRADIENT_STOPS;
  const logo = brandLogoUrl();
  const beans = coffeeBeansBgUrl();
  /** Very subtle bean texture on the page background only */
  const beansBg = beans
    ? `background-image:url('${beans}');background-repeat:repeat;background-size:560px auto;background-position:center top;`
    : '';
  const logoBlock = logo
    ? `<img src="${logo}" alt="Mokanco" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;border:0;" />`
    : '';

  const preheaderBlock = preheader
    ? `<div style="display:none!important;font-size:1px;color:${PAGE_BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <title>Mokanco</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};font-family:${FONT};color:${TEXT_BLACK};-webkit-text-size-adjust:100%;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${PAGE_BG};${beansBg}">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;margin:0 auto;">
          <tr>
            <td style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,38,27,0.08);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;">
                <tr>
                  <td width="6" style="width:6px;min-width:6px;background:${c2};background-image:linear-gradient(180deg,${c1} 0%,${c2} 50%,${c3} 100%);font-size:0;line-height:0;">&nbsp;</td>
                  <td style="padding:0;vertical-align:top;background-color:#ffffff;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:rgba(255,251,247,0.97);">
                      <tr>
                        <td style="padding:28px 28px 32px 22px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="font-size:0;line-height:0;">&nbsp;</td>
                              <td align="right" valign="top" width="52" style="width:52px;padding-bottom:8px;">
                                ${logoBlock}
                              </td>
                            </tr>
                          </table>
                          <div style="color:${TEXT_BLACK};">
                            ${bodyHtml}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 8px 0;font-size:12px;line-height:1.5;color:${TEXT_MUTED};font-family:${FONT};">
              Moka&amp;Co portal
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * @param {string} html inner escaped paragraphs
 */
export function renderBodyParagraph(html, opts = {}) {
  const { large = false } = opts;
  const size = large ? '16px' : '15px';
  return `<p style="margin:0 0 16px;font-size:${size};line-height:1.55;color:${TEXT_BLACK};font-family:${FONT};">${html}</p>`;
}

/** @param {string} html escaped */
export function renderFooterNote(html) {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${TEXT_MUTED};font-family:${FONT};">${html}</p>`;
}

/** @param {string} text escaped */
export function renderInlineCode(text) {
  return `<code style="display:inline-block;background:#f4f4f5;padding:4px 10px;border-radius:6px;font-family:ui-monospace,Consolas,monospace;font-size:14px;color:${TEXT_BLACK};">${text}</code>`;
}

export { TEXT_BLACK, TEXT_MUTED };
