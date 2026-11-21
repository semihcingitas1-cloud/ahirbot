// AhırBot e-posta şablonu. Bağımlılıksız; Gmail, Outlook ve Apple Mail için
// tablo tabanlı yerleşim + inline stil kullanır. utils/page.js ile aynı görünüm.
//
// Kullanım:
//   const mail = emailTemplate({ preheader, title, greeting, paragraphs, button, code, note });
//   await sendEmail({ to, subject, ...mail });   // mail = { html, text }
//
// paragraphs içindeki metinler HTML olarak eklenir (içine kullanıcı verisi koyacaksanız esc() kullanın).
// title, greeting, preheader, button.label, code ve note otomatik kaçışlanır.

const { esc } = require('./page');

const C = {
  bg: '#f3f6f4', card: '#ffffff', line: '#dde6e0', text: '#14231c', muted: '#64746b',
  brand: '#1b7a52', danger: '#d6453d', codeBg: '#eef5f0',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const stripTags = (s = '') => String(s).replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const emailTemplate = ({ preheader = '', title, greeting, paragraphs = [], button, code, after = [], note, tone = 'brand' } = {}) => {
  const accent = tone === 'danger' ? C.danger : C.brand;
  const p = (html, extra = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.muted};${extra}">${html}</p>`;

  const buttonHtml = button ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto 8px">
      <tr><td align="center" bgcolor="${accent}" style="border-radius:12px">
        <a href="${esc(button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(button.label)}</a>
      </td></tr>
    </table>
    <p style="margin:12px 0 0;font-size:12.5px;line-height:1.5;color:${C.muted};text-align:center">Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>
      <a href="${esc(button.url)}" style="color:${accent};word-break:break-all">${esc(button.url)}</a></p>` : '';

  const codeHtml = code ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 18px">
      <tr><td align="center" bgcolor="${C.codeBg}" style="border-radius:14px;padding:18px 12px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:10px;color:${C.text}">${esc(code)}</td></tr>
    </table>` : '';

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title || 'AhırBot')}</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.bg}" style="background:${C.bg}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px">
      <tr><td align="center" style="padding:0 0 18px;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.3px;color:${C.text}">Ahır<span style="color:${C.brand}">Bot</span></td></tr>
      <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:18px;padding:32px 28px;font-family:${FONT}">
        ${title ? `<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:800;color:${C.text}">${esc(title)}</h1>` : ''}
        ${greeting ? p(esc(greeting), `color:${C.text}`) : ''}
        ${paragraphs.map((x) => p(x)).join('')}
        ${codeHtml}${buttonHtml}
        ${after.map((x) => p(x, 'margin-top:14px')).join('')}
        ${note ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:22px"><tr><td style="border-top:1px solid ${C.line};padding-top:16px;font-size:13px;line-height:1.55;color:${C.muted}">${esc(note)}</td></tr></table>` : ''}
      </td></tr>
      <tr><td align="center" style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted}">
        Bu e-posta AhırBot hesabınızla ilgili olduğu için gönderildi.<br>© ${new Date().getFullYear()} AhırBot
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Düz metin sürümü (spam puanı için önemli; sendEmail'in otomatik dönüşümünden daha temiz)
  const text = [
    'AhırBot', '',
    title, '', greeting, '',
    ...paragraphs.map(stripTags),
    code && `\n    ${code}\n`,
    button && `${button.label}: ${button.url}`,
    ...after.map(stripTags),
    note && `\n${note}`,
    '', '—', `© ${new Date().getFullYear()} AhırBot`,
  ].filter((x) => x !== undefined && x !== null && x !== false).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { html, text };
};

module.exports = { emailTemplate };
