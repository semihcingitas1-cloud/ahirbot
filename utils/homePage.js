// Sunucu adresi tarayıcıda açılınca görünen durum sayfası
const homePage = ({ dbOk, version, mail }) => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AhırBot API</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#14231c;
background:linear-gradient(170deg,#0f3d2e 0%,#145c41 42%,#f4f8f5 42.1%)}
.card{width:calc(100% - 32px);max-width:400px;background:#fff;border-radius:28px;padding:32px 26px 26px;box-shadow:0 20px 50px -20px rgba(15,61,46,.45);text-align:center}
.logo{width:84px;height:84px;margin:-74px auto 14px;border-radius:26px;background:#0f3d2e;display:grid;place-items:center;box-shadow:0 10px 24px rgba(15,61,46,.35)}
h1{margin:0;font-size:26px;letter-spacing:-.5px}h1 span{color:#22995f}
.sub{margin:6px 0 22px;color:#6b7c73;font-size:14px}
.row{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;background:#f4f8f5;border-radius:16px;margin-bottom:10px;font-size:14px}
.pill{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:13px;padding:5px 11px;border-radius:20px}
.ok{background:#e6f5ec;color:#1b7a52}.bad{background:#fde8e7;color:#e5534b}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor}
.ok .dot{animation:p 1.6s infinite}@keyframes p{0%{box-shadow:0 0 0 0 rgba(34,153,95,.5)}100%{box-shadow:0 0 0 8px rgba(34,153,95,0)}}
.err{margin:-2px 4px 12px;text-align:left;font-size:12.5px;line-height:1.5;color:#b5403a;background:#fff6f5;border-radius:12px;padding:10px 12px}
.foot{margin-top:18px;font-size:12px;color:#9aa8a0}
</style></head>
<body><div class="card">
<div class="logo"><svg width="56" height="56" viewBox="0 0 64 64"><rect x="14" y="24" width="38" height="20" rx="8" fill="#b8e04a"/><rect x="22" y="14" width="22" height="12" rx="4" fill="#fff"/><circle cx="28" cy="20" r="2.4" fill="#145c41"/><circle cx="38" cy="20" r="2.4" fill="#145c41"/><rect x="4" y="30" width="6" height="20" rx="2" fill="#fff"/><path d="M10 40h4" stroke="#fff" stroke-width="3"/><circle cx="24" cy="48" r="6" fill="#fff"/><circle cx="44" cy="48" r="6" fill="#fff"/><circle cx="24" cy="48" r="2.5" fill="#145c41"/><circle cx="44" cy="48" r="2.5" fill="#145c41"/><path d="M33 4v9" stroke="#b8e04a" stroke-width="3" stroke-linecap="round"/></svg></div>
<h1>Ahır<span>Bot</span> API</h1>
<p class="sub">Otonom ahır temizleme robotu sunucusu</p>
<div class="row"><span>Sunucu</span><span class="pill ok"><span class="dot"></span>Çalışıyor</span></div>
<div class="row"><span>Veritabanı</span>${dbOk ? '<span class="pill ok"><span class="dot"></span>Bağlı</span>' : '<span class="pill bad"><span class="dot"></span>Bağlantı yok</span>'}</div>
<div class="row"><span>E-posta</span>${mail.ok ? '<span class="pill ok"><span class="dot"></span>Hazır</span>' : '<span class="pill bad"><span class="dot"></span>Hata</span>'}</div>
${mail.ok ? '' : `<p class="err">${mail.reason}</p>`}
<div class="row"><span>Sürüm</span><b>v${version}</b></div>
<p class="foot">${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p>
</div></body></html>`;

module.exports = homePage;
