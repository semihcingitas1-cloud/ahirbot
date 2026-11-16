// E-postadaki bağlantılar tarayıcıda açılınca gösterilen basit sayfalar
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · AhırBot</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f8f5;color:#14231c;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;border-radius:24px;padding:32px 28px;max-width:380px;width:calc(100% - 32px);box-shadow:0 10px 30px rgba(15,61,46,.12);text-align:center}
h1{font-size:22px;margin:12px 0 8px}p{color:#6b7c73;line-height:1.5}.logo{width:64px;height:64px;border-radius:20px;background:#0f3d2e;display:grid;place-items:center;margin:0 auto;color:#b8e04a;font-size:30px}
input{width:100%;box-sizing:border-box;height:48px;border:1.5px solid #e3ebe6;border-radius:14px;padding:0 14px;font-size:15px;margin:6px 0}
button{width:100%;height:50px;border:0;border-radius:14px;background:#1b7a52;color:#fff;font-weight:700;font-size:16px;margin-top:10px}.ok{color:#1b7a52}.err{color:#e5534b}</style></head>
<body><div class="c"><div class="logo">🤖</div>${body}</div></body></html>`;

module.exports = { page, esc };
