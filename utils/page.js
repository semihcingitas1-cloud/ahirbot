// E-postadaki bağlantılar tarayıcıda açılınca gösterilen basit sayfalar.
// Bağımlılıksız tek dosya. Kullanım değişmedi: page(title, body) ve esc(s).
// İsteğe bağlı 3. parametre: page(title, body, { status: 'ok' | 'err' | 'info' })
// Verilmezse body'deki <h1 class="ok|err"> etiketinden otomatik anlaşılır.

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ICONS = {

  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>',
  err: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 16.5v.5" /></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12v9H6z" /></svg>',
};

const detectStatus = (body) => {

  const m = /<h1[^>]*class="[^"]*\b(ok|err)\b/.exec(body);
  return m ? m[1] : 'info';
};

const CSS = `

:root{--bg:#f3f6f4;--card:#fff;--text:#14231c;--muted:#64746b;--line:#dde6e0;--brand:#1b7a52;--brand-2:#156443;--ok:#1b7a52;--ok-bg:#e6f4ec;--err:#d6453d;--err-bg:#fcebea;--info:#3d5a4c;--info-bg:#eaf0ec;--ring:rgba(27,122,82,.28);--shadow:0 1px 2px rgba(16,40,30,.06),0 12px 32px rgba(16,40,30,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#0d1512;--card:#152019;--text:#e6efe9;--muted:#93a49a;--line:#26352d;--brand:#2fa36f;--brand-2:#3bb57d;--ok:#4cc58c;--ok-bg:rgba(76,197,140,.12);--err:#f0726b;--err-bg:rgba(240,114,107,.12);--info:#a9bdb2;--info-bg:rgba(169,189,178,.1);--ring:rgba(47,163,111,.4);--shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px rgba(0,0,0,.35)}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px 16px;-webkit-font-smoothing:antialiased}
.brand{font-weight:800;font-size:18px;letter-spacing:-.02em;color:var(--text);margin-bottom:18px;text-decoration:none}
.brand span{color:var(--brand)}
.c{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px 28px 28px;max-width:400px;width:100%;box-shadow:var(--shadow);text-align:center}
.st{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;margin:0 auto 16px}
.st svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.st.ok{background:var(--ok-bg);color:var(--ok)}.st.err{background:var(--err-bg);color:var(--err)}.st.info{background:var(--info-bg);color:var(--info)}
h1{font-size:21px;line-height:1.3;letter-spacing:-.01em;margin:0 0 8px;color:var(--text)}
h1.ok,h1.err{color:var(--text)}
p{color:var(--muted);margin:0 0 12px}
p.ok{color:var(--ok)}p.err{color:var(--err);background:var(--err-bg);border-radius:12px;padding:10px 12px;font-size:14px}
b,strong{color:var(--text)}
form{margin-top:18px;text-align:left}
input:not([type=checkbox]):not([type=radio]){display:block;width:100%;height:48px;border:1.5px solid var(--line);border-radius:12px;padding:0 14px;font:inherit;font-size:15px;margin:0 0 10px;background:var(--card);color:var(--text);transition:border-color .15s,box-shadow .15s}
input::placeholder{color:var(--muted);opacity:.8}
input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px var(--ring)}
input:user-invalid{border-color:var(--err)}
input[type=checkbox]{accent-color:var(--brand);width:18px;height:18px}
label{color:var(--muted)!important}
button{width:100%;height:50px;border:0;border-radius:12px;background:var(--brand);color:#fff;font:inherit;font-weight:700;font-size:16px;margin-top:8px;cursor:pointer;transition:background .15s,transform .05s,box-shadow .15s}
button:hover{background:var(--brand-2)}
button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 4px var(--ring)}
button:disabled{opacity:.6;cursor:default}
.foot{margin-top:20px;font-size:12.5px;color:var(--muted)}
@media (max-width:420px){.c{padding:26px 20px 22px;border-radius:18px}}
`;

const page = (title, body = '', opts = {}) => {

  const status = opts.status || detectStatus(body);
  const icon = ICONS[status] || ICONS.info;
  const year = new Date().getFullYear();

  return `<!doctype html>

    <html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">

      <meta name="color-scheme" content="light dark"><meta name="robots" content="noindex">

      <title>${esc(title)} · AhırBot</title><style>${CSS}</style></head>

      <body>

        <div class="brand">Ahır<span>Bot</span></div>
        <main class="c"><div class="st ${status}">${icon}</div>${body}</main>
        <div class="foot">© ${year} AhırBot</div>

        <script>document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(){var b=f.querySelector('button[type=submit],button:not([type])');if(b){b.disabled=true;b.dataset.t=b.textContent;b.textContent='Lütfen bekleyin…';}});});</script>

      </body>

    </html>`;
  };

module.exports = { page, esc };
