// AhırBot yönetim paneli. Derleme gerektirmez: düz JavaScript, veriler /admin/api'den.
// Güvenlik: token sessionStorage'da (sekme kapanınca silinir), tüm metinler textContent ile basılır.
(function () {
  'use strict';

  var API = '/admin/api';
  var TOKEN_KEY = 'ahirbot_admin_token';
  var app = document.getElementById('app');
  var me = null;

  var STATUS = {
    cleaning: ['Temizlikte', ''], idle: ['Beklemede', 'grey'], charging: ['Şarjda', 'amber'], emptying: ['Boşaltıyor', 'amber'],
    paused: ['Duraklatıldı', 'amber'], blocked: ['Yol kapalı', 'red'], error: ['Arıza', 'red'], offline: ['Çevrimdışı', 'grey'],
  };
  var ALARMS = {
    E01: 'Yol kapalı', E02: 'Atık haznesi dolu', E03: 'Batarya düşük', E04: 'Bağlantı koptu', E05: 'Sıkışma / motor', E06: 'Robot arızası',
    E07: 'Şarj istasyonu bulunamadı', E08: 'Güncelleme başarısız', E09: 'Su haznesi boş', E10: 'Amonyak yüksek',
    M01: 'Fırça bakımı', M02: 'Palet / tekerlek bakımı', M03: 'Batarya kontrolü',
  };
  var NAV = [['overview', 'Genel bakış'], ['users', 'Kullanıcılar'], ['robots', 'Robotlar'], ['alarms', 'Alarmlar'], ['runs', 'Turlar'], ['errors', 'Hatalar'], ['ota', 'Yazılım (OTA)']];
  var OTA_STATE = { queued: ['Kuyrukta', 'grey'], sent: ['Robot aldı', 'blue'], downloading: ['İndiriyor', 'amber'], success: ['Güncellendi', ''], failed: ['Başarısız', 'red'], no_update: ['Zaten güncel', 'grey'] };
  var KIND = { error: ['Hata', 'red'], render: ['Ekran çöktü', 'red'], promise: ['Promise', 'amber'], server: ['Sunucu', 'dark'], handled: ['Yakalanan', 'grey'] };

  // ─── Yardımcılar ───
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmtN(n) { return Number(n || 0).toLocaleString('tr-TR'); }
  function fmtDate(d, time) {
    if (!d) return '—';
    var o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (time) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(d).toLocaleString('tr-TR', o);
  }
  function ago(d) {
    if (!d) return 'hiç';
    var s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return Math.floor(s / 60) + ' dk önce';
    if (s < 86400) return Math.floor(s / 3600) + ' sa önce';
    return Math.floor(s / 86400) + ' gün önce';
  }
  function pill(text, tone) { return h('span', { class: 'pill ' + (tone || '') }, text); }
  function statusPill(s) { var m = STATUS[s] || [s, 'grey']; return pill(m[0], m[1]); }
  function toast(msg, bad) {
    var t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function call(method, url, body) {
    var token = sessionStorage.getItem(TOKEN_KEY);
    return fetch(API + url, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); me = null; renderLogin(data.message); throw new Error(data.message || 'Oturum gerekli'); }
        if (!r.ok) throw new Error(data.message || ('Hata ' + r.status));
        return data;
      });
    });
  }
  function fail(e) { if (me) toast(e.message || 'Bir sorun oluştu', true); }

  // Ham dosya yükleme (.bin): gövde dosyanın kendisi, ek bilgiler başlıklarda
  function upload(url, file, headers) {
    var token = sessionStorage.getItem(TOKEN_KEY);
    return fetch(API + url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + token }, headers || {}),
      body: file,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); me = null; renderLogin(data.message); throw new Error(data.message || 'Oturum gerekli'); }
        if (r.status === 413) throw new Error('Dosya çok büyük (Vercel en çok 4,5 MB kabul eder).');
        if (!r.ok) throw new Error(data.message || ('Hata ' + r.status));
        return data;
      });
    });
  }
  function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(2).replace('.', ',') + ' MB' : Math.round(b / 1024) + ' KB'; }
  function otaPill(o) { if (!o) return '—'; var m = OTA_STATE[o.state] || [o.state, 'grey']; return pill(m[0], m[1]); }

  function modal(title, body, actions) {
    var m = h('div', { class: 'modal', onclick: function (e) { if (e.target === m) m.remove(); } },
      h('div', { class: 'card' }, h('h3', null, title), body, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, actions)));
    document.body.appendChild(m);
    return m;
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var m = modal(title, h('p', { class: 'muted' }, text), [
        h('button', { class: 'btn light', onclick: function () { m.remove(); resolve(false); } }, 'Vazgeç'),
        h('button', { class: 'btn' + (danger ? ' red' : ''), onclick: function () { m.remove(); resolve(true); } }, okLabel),
      ]);
    });
  }
  function promptBox(title, text, placeholder) {
    return new Promise(function (resolve) {
      var inp = h('input', { placeholder: placeholder, autocomplete: 'off' });
      var m = modal(title, [h('p', { class: 'muted' }, text), inp], [
        h('button', { class: 'btn light', onclick: function () { m.remove(); resolve(null); } }, 'Vazgeç'),
        h('button', { class: 'btn', onclick: function () { m.remove(); resolve(inp.value.trim()); } }, 'Gönder'),
      ]);
      inp.focus();
    });
  }

  function pager(data, go) {
    var pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    return h('div', { class: 'pager' },
      h('span', { class: 'muted small' }, fmtN(data.total) + ' kayıt · sayfa ' + (data.page + 1) + '/' + pages),
      h('button', { class: 'btn light sm', disabled: data.page <= 0, onclick: function () { go(data.page - 1); } }, '‹ Önceki'),
      h('button', { class: 'btn light sm', disabled: data.page + 1 >= pages, onclick: function () { go(data.page + 1); } }, 'Sonraki ›'));
  }
  function table(cols, rows, onRow) {
    if (!rows.length) return h('div', { class: 'empty' }, 'Kayıt yok');
    return h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { class: c.m ? 'hide-m' : null }, c.t); }))),
      h('tbody', null, rows.map(function (r) {
        return h('tr', { class: onRow ? 'click' : null, onclick: onRow ? function (e) { if (e.target.tagName !== 'BUTTON') onRow(r); } : null },
          cols.map(function (c) { return h('td', { class: c.m ? 'hide-m' : null }, c.v(r)); }));
      }))));
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  // ─── Giriş ───
  function renderLogin(msg) {
    var email = h('input', { type: 'email', placeholder: 'E-posta', autocomplete: 'username' });
    var pass = h('input', { type: 'password', placeholder: 'Şifre', autocomplete: 'current-password' });
    var err = h('div', { class: 'err' }, msg && msg !== 'Yönetici girişi gerekli.' ? msg : '');
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Giriş yap');
    var form = h('form', {
      onsubmit: function (e) {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        call('POST', '/login', { email: email.value, password: pass.value }).then(function (d) {
          sessionStorage.setItem(TOKEN_KEY, d.token);
          me = d.admin;
          route();
        }).catch(function (e) { err.textContent = e.message; }).finally(function () { btn.disabled = false; });
      },
    }, email, pass, err, btn);
    clear(app).appendChild(h('div', { class: 'login' }, h('div', { class: 'card' },
      h('div', { class: 'logo' }, '🤖'), h('h1', null, 'AhırBot Yönetim'), h('p', { class: 'sub' }, 'Yönetici hesabınızla giriş yapın.'), form)));
    email.focus();
  }

  function logout() { sessionStorage.removeItem(TOKEN_KEY); me = null; location.hash = ''; renderLogin(); }

  // ─── Sayfa iskeleti ───
  function shell(active, title, sub) {
    var links = function (cls) {
      return NAV.map(function (n) { return h('a', { href: '#/' + n[0], class: active === n[0] ? 'on' : null }, n[1]); });
    };
    var main = h('div', { class: 'main' }, h('h1', null, title), h('p', { class: 'sub' }, sub || ''));
    clear(app).appendChild(h('div', null,
      h('nav', { class: 'top' }, links(), h('a', { href: '#', onclick: function (e) { e.preventDefault(); logout(); } }, 'Çıkış')),
      h('div', { class: 'layout' },
        h('aside', { class: 'side' }, h('div', { class: 'brand' }, h('i', null, '🤖'), 'AhırBot Yönetim'), links(),
          h('div', { class: 'who' }, me ? me.name : '', h('br'), me ? me.email : '', h('button', { class: 'btn ghost sm', onclick: logout }, 'Çıkış yap'))),
        main)));
    return main;
  }
  function loading(el) { var l = h('div', { class: 'empty' }, 'Yükleniyor…'); el.appendChild(l); return l; }

  // ─── Genel bakış ───
  function chart(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    return [
      h('div', { class: 'bars' }, rows.map(function (r) { return h('div', { style: 'height:' + Math.max(2, (r.v / max) * 100) + '%', title: r.d + ': ' + r.v }, h('span', null, r.v || '')); })),
      h('div', { class: 'axis' }, rows.map(function (r, i) { return h('span', null, i % 2 === rows.length % 2 ? r.d.slice(8) : ''); })),
    ];
  }
  function stat(label, value, sub) { return h('div', { class: 'card stat' }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), h('div', { class: 's' }, sub || '')); }

  function pageOverview() {
    var main = shell('overview', 'Genel bakış', 'Tüm çiftlikler ve robotlar');
    var l = loading(main);
    call('GET', '/stats').then(function (s) {
      l.remove();
      main.appendChild(h('div', { class: 'grid g4' },
        stat('Kullanıcı', fmtN(s.users.total), '+' + s.users.new7 + ' son 7 gün · ' + s.users.verified + ' doğrulanmış'),
        stat('Çevrimiçi robot', s.robots.online + ' / ' + s.robots.total, s.barns + ' ahır · ' + s.members + ' ekip üyesi'),
        stat('Son 7 gün tur', fmtN(s.runs7.n), fmtN(s.runs7.areaM2) + ' m² · ' + fmtN(s.runs7.wasteKg) + ' kg atık'),
        stat('Bakım bekleyen', fmtN(s.robots.maintenanceDue), 'robot · ' + s.users.disabled + ' askıda hesap')));
      if (s.errors && s.errors.open) {
        main.appendChild(h('a', { href: '#/errors', class: 'card row', style: 'margin-top:14px;justify-content:space-between;color:inherit' },
          h('span', null, pill(s.errors.open + ' açık hata', 'red'), ' ', h('span', { class: 'muted' }, 'Son 24 saatte ' + s.errors.last24 + ' farklı hata görüldü')),
          h('b', { style: 'color:var(--g700)' }, 'Hatalara git ›')));
      }
      main.appendChild(h('div', { class: 'grid g2', style: 'margin-top:14px' },
        h('div', { class: 'card' }, h('h3', null, 'Günlük tur (14 gün)'), chart(s.charts.runs)),
        h('div', { class: 'card' }, h('h3', null, 'Yeni kayıt (14 gün)'), chart(s.charts.signups))));
      var statuses = Object.keys(STATUS).filter(function (k) { return s.robots.byStatus[k]; });
      main.appendChild(h('div', { class: 'grid g2', style: 'margin-top:14px' },
        h('div', { class: 'card' }, h('h3', null, 'Robot durumları'),
          statuses.length ? h('div', { class: 'list' }, statuses.map(function (k) {
            return h('div', { class: 'row', style: 'justify-content:space-between' }, statusPill(k), h('b', null, s.robots.byStatus[k]));
          })) : h('div', { class: 'empty' }, 'Robot yok'),
          h('h3', { style: 'margin-top:16px' }, 'Yazılım sürümleri'),
          h('div', { class: 'list' }, s.robots.firmware.map(function (f) {
            return h('div', { class: 'row', style: 'justify-content:space-between' }, h('a', { href: '#/robots?firmware=' + encodeURIComponent(f.version) }, f.version), h('b', null, f.n));
          }))),
        h('div', { class: 'card' }, h('h3', null, 'Son 24 saatteki alarmlar'),
          s.alarms24.length ? h('div', { class: 'list' }, s.alarms24.map(function (a) {
            return h('div', { class: 'row', style: 'justify-content:space-between' },
              h('a', { href: '#/alarms?code=' + a.code }, pill(a.code, a.code[0] === 'M' ? 'blue' : 'red'), ' ', ALARMS[a.code] || ''), h('b', null, a.n));
          })) : h('div', { class: 'empty' }, 'Son 24 saatte alarm yok 👍'))));
    }).catch(fail);
  }

  // ─── Kullanıcılar ───
  function pageUsers(q) {
    var main = shell('users', 'Kullanıcılar', 'Hesaplar, çiftlik sahipleri ve ekip üyeleri');
    var search = h('input', { type: 'search', placeholder: 'Ad, e-posta ya da telefon ara', value: q.q || '' });
    var filter = h('select', null, [['', 'Tümü'], ['admin', 'Yöneticiler'], ['disabled', 'Askıdakiler'], ['unverified', 'Doğrulanmamış']].map(function (o) { return h('option', { value: o[0], selected: q.filter === o[0] }, o[1]); }));
    var box = h('div', { class: 'card' });
    main.appendChild(h('div', { class: 'toolbar' }, search, filter));
    main.appendChild(box);
    var load = function (page) {
      clear(box); loading(box);
      call('GET', '/users?' + new URLSearchParams({ q: search.value, filter: filter.value, page: page || 0 })).then(function (d) {
        clear(box).appendChild(table([
          { t: 'Ad', v: function (u) { return [h('div', { class: 'b' }, u.name), h('div', { class: 'muted small' }, u.email)]; } },
          { t: 'Durum', v: function (u) { return h('div', { class: 'row' }, u.admin ? pill('Yönetici', 'dark') : null, u.disabled ? pill('Askıda', 'red') : null, !u.verified ? pill('Doğrulanmamış', 'amber') : null, u.memberOf ? pill('Ekip: ' + u.memberOf.owner, 'blue') : null); } },
          { t: 'Robot', v: function (u) { return u.robots; } },
          { t: 'Ahır', m: 1, v: function (u) { return u.barns; } },
          { t: 'Kayıt', m: 1, v: function (u) { return fmtDate(u.createdAt); } },
          { t: 'Son giriş', m: 1, v: function (u) { return ago(u.lastLoginAt); } },
        ], d.users, function (u) { location.hash = '#/users/' + u.id; }));
        box.appendChild(pager(d, load));
      }).catch(fail);
    };
    search.addEventListener('input', debounce(function () { load(0); }, 300));
    filter.addEventListener('change', function () { load(0); });
    load(0);
  }

  function pageUser(id) {
    var main = shell('users', 'Kullanıcı', '');
    var l = loading(main);
    call('GET', '/users/' + id).then(function (d) {
      l.remove();
      var u = d.user;
      main.querySelector('h1').textContent = u.name;
      main.querySelector('.sub').textContent = u.email;
      var patch = function (body, msg) {
        call('PATCH', '/users/' + id, body).then(function () { toast(msg); pageUser(id); }).catch(fail);
      };
      var self = me && me.id === u.id;
      var actions = h('div', { class: 'row' },
        !self && h('button', { class: 'btn ' + (u.disabled ? '' : 'red'), onclick: function () {
          confirmBox(u.disabled ? 'Hesabı aç' : 'Hesabı askıya al', u.disabled ? u.email + ' tekrar giriş yapabilecek.' : u.email + ' uygulamaya giremeyecek ve açık oturumları kapanacak. Robotları çalışmaya devam eder.', u.disabled ? 'Aç' : 'Askıya al', !u.disabled)
            .then(function (ok) { if (ok) patch({ disabled: !u.disabled }, u.disabled ? 'Hesap açıldı' : 'Hesap askıya alındı'); });
        } }, u.disabled ? 'Hesabı aç' : 'Askıya al'),
        !self && h('button', { class: 'btn light', onclick: function () {
          confirmBox(u.role === 'admin' ? 'Yöneticilikten çıkar' : 'Yönetici yap', u.role === 'admin' ? u.email + ' artık bu panele giremeyecek.' : u.email + ' bu panele girip tüm verileri görebilecek.', 'Onayla')
            .then(function (ok) { if (ok) patch({ role: u.role === 'admin' ? 'user' : 'admin' }, 'Yetki güncellendi'); });
        } }, u.role === 'admin' ? 'Yöneticilikten çıkar' : 'Yönetici yap'),
        !u.verified && h('button', { class: 'btn light', onclick: function () { patch({ verified: true }, 'E-posta doğrulanmış sayıldı'); } }, 'E-postayı doğrulanmış say'),
        !self && h('button', { class: 'btn red', onclick: function () {
          promptBox('Hesabı kalıcı olarak sil', u.email + ' hesabı ve çiftliğine ait her şey (robotlar, ahırlar, görevler, turlar, bildirimler, ekip) silinir. Geri alınamaz. Onaylamak için e-posta adresini yazın.', u.email)
            .then(function (v) {
              if (v == null) return;
              if (v.toLowerCase() !== u.email) return toast('E-posta eşleşmedi, silinmedi', true);
              call('DELETE', '/users/' + id).then(function (r) { toast('Hesap silindi (' + r.deleted.robots + ' robot, ' + r.deleted.barns + ' ahır)'); location.hash = '#/users'; }).catch(fail);
            });
        } }, 'Hesabı sil'),
        h('a', { class: 'btn light', href: '#/users', style: 'display:inline-flex;align-items:center' }, '‹ Listeye dön'));
      main.appendChild(actions);
      main.appendChild(h('div', { class: 'grid g2', style: 'margin-top:14px' },
        h('div', { class: 'card' }, h('h3', null, 'Hesap'), h('div', { class: 'kv' },
          h('div', null, 'Telefon'), h('div', null, u.phone || '—'),
          h('div', null, 'Durum'), h('div', { class: 'row' }, u.admin ? pill('Yönetici', 'dark') : pill('Kullanıcı', 'grey'), u.disabled ? pill('Askıda', 'red') : pill('Aktif'), u.verified ? null : pill('Doğrulanmamış', 'amber')),
          h('div', null, 'Hayvan sayısı'), h('div', null, u.herdSize || '—'),
          h('div', null, 'Kayıt'), h('div', null, fmtDate(u.createdAt, true)),
          h('div', null, 'Son giriş'), h('div', null, u.lastLoginAt ? fmtDate(u.lastLoginAt, true) : 'hiç'),
          h('div', null, 'Son 30 gün tur'), h('div', null, d.runs30),
          h('div', null, 'Ekip üyeliği'), h('div', null, d.memberOf ? d.memberOf.owner + ' çiftliği (' + (d.memberOf.role === 'manager' ? 'yönetici' : 'çalışan') + ')' : '—'))),
        h('div', { class: 'card' }, h('h3', null, 'Ahırlar ve ekip'),
          d.barns.length ? h('div', { class: 'list' }, d.barns.map(function (b) { return h('div', null, h('b', null, b.fullName || b.name), h('span', { class: 'muted' }, ' · ' + (b.heads || 0) + ' baş')); })) : h('div', { class: 'muted' }, 'Ahır yok'),
          h('h3', { style: 'margin-top:14px' }, 'Ekip (' + d.team.length + ')'),
          d.team.length ? h('div', { class: 'list' }, d.team.map(function (m) { return h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', null, m.name || m.email), h('span', null, pill(m.role === 'manager' ? 'Yönetici' : 'Çalışan', 'blue'), ' ', m.status === 'pending' ? pill('Bekliyor', 'amber') : null)); })) : h('div', { class: 'muted' }, 'Ekip üyesi yok'))));
      main.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'Robotlar (' + d.robots.length + ')'), robotTable(d.robots, function () { pageUser(id); }, true)));
      main.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'Son bildirimler'),
        table([
          { t: 'Zaman', v: function (n) { return fmtDate(n.createdAt, true); } },
          { t: 'Kod', v: function (n) { return n.code ? pill(n.code, n.code[0] === 'M' ? 'blue' : 'red') : '—'; } },
          { t: 'Bildirim', v: function (n) { return [h('div', { class: 'b' }, n.title), h('div', { class: 'muted small' }, n.body)]; } },
          { t: 'Robot', m: 1, v: function (n) { return n.robot; } },
        ], d.notifications)));
    }).catch(function (e) { l.textContent = e.message; });
  }

  // ─── Robotlar ───
  function robotActions(r, reload) {
    var cmd = function (command, payload, msg) {
      call('POST', '/robots/' + r.id + '/command', { command: command, payload: payload }).then(function () { toast(msg); reload(); }).catch(fail);
    };
    return h('div', { class: 'row acts' },
      h('button', { class: 'btn red sm', title: 'Acil durdur', onclick: function () { cmd('stop', null, r.name + ' durduruldu'); } }, 'Durdur'),
      h('button', { class: 'btn light sm', onclick: function () { cmd('dock', null, r.name + ' şarja gönderildi'); } }, 'Şarja'),
      h('button', { class: 'btn light sm', onclick: function () {
        otaModal({ robotIds: [r.id] }, r.name + ' (şu an ' + (r.firmwareVersion || 'bilinmiyor') + ')', reload);
      } }, 'OTA'),
      h('button', { class: 'btn light sm', onclick: function () {
        confirmBox('Anahtarı yenile', 'Eski anahtar hemen geçersiz olur; robot yeni anahtar girilene kadar bağlanamaz.', 'Yenile', true).then(function (ok) {
          if (!ok) return;
          call('POST', '/robots/' + r.id + '/rotate-key').then(function (k) {
            var m = modal('Yeni cihaz anahtarı', [h('p', { class: 'muted' }, 'Bir daha gösterilmeyecek. Robotun seri monitörüne yapıştırın:'),
              h('div', { class: 'keybox' }, '{"ssid":"WIFI_ADI","password":"WIFI_SIFRESI","deviceKey":"' + k.deviceKey + '"}')],
              [h('button', { class: 'btn', onclick: function () { m.remove(); } }, 'Kapat')]);
          }).catch(fail);
        });
      } }, 'Anahtar'),
      h('button', { class: 'btn red sm', onclick: function () {
        confirmBox('Robotu sil', r.name + ' (' + r.serialNumber + ') hesaptan silinir, bekleyen görevleri kalkar. Seri numarası başka bir hesaba eklenebilir hale gelir.', 'Sil', true)
          .then(function (ok) { if (ok) call('DELETE', '/robots/' + r.id).then(function () { toast('Robot silindi'); reload(); }).catch(fail); });
      } }, 'Sil'));
  }

  function robotTable(rows, reload, noOwner) {
    return table([
      { t: 'Robot', v: function (r) { return [h('div', { class: 'b' }, h('span', { class: 'dot' + (r.status !== 'offline' ? ' on' : '') }), r.name), h('div', { class: 'muted small' }, r.serialNumber)]; } },
      !noOwner && { t: 'Sahip', v: function (r) { return r.owner ? h('a', { href: '#/users/' + r.owner.id }, r.owner.name) : '—'; } },
      { t: 'Durum', v: function (r) { return h('div', { class: 'row' }, statusPill(r.status), r.maintenanceDue.length ? pill('Bakım', 'amber') : null); } },
      { t: 'Batarya', m: 1, v: function (r) { return '%' + Math.round(r.battery || 0); } },
      { t: 'Yazılım', m: 1, v: function (r) { return [h('div', null, r.firmwareVersion || '—'), r.ota && r.ota.state !== 'success' && r.ota.state !== 'no_update' ? h('div', { class: 'small' }, otaPill(r.ota), r.ota.version ? ' → ' + r.ota.version : '') : null]; } },
      { t: 'Son sinyal', m: 1, v: function (r) { return ago(r.lastSeenAt); } },
      { t: '', v: function (r) { return robotActions(r, reload); } },
    ].filter(Boolean), rows);
  }

  function pageRobots(q) {
    var main = shell('robots', 'Robotlar', 'Tüm çiftliklerdeki robotlar');
    var search = h('input', { type: 'search', placeholder: 'Robot adı, seri no ya da sahip ara', value: q.q || '' });
    var status = h('select', null, [['', 'Tümü'], ['online', 'Çevrimiçi'], ['offline', 'Çevrimdışı'], ['problem', 'Sorunlu (yol kapalı / arıza)']].map(function (o) { return h('option', { value: o[0], selected: q.status === o[0] }, o[1]); }));
    var fw = q.firmware || '';
    var box = h('div', { class: 'card' });
    main.appendChild(h('div', { class: 'toolbar' }, search, status, fw ? h('button', { class: 'btn light', onclick: function () { location.hash = '#/robots'; } }, 'Sürüm: ' + fw + ' ✕') : null));
    main.appendChild(box);
    var page = 0;
    var load = function (p) {
      page = p || 0;
      clear(box); loading(box);
      call('GET', '/robots?' + new URLSearchParams({ q: search.value, status: status.value, firmware: fw, page: page })).then(function (d) {
        clear(box).appendChild(robotTable(d.robots, function () { load(page); }));
        box.appendChild(pager(d, load));
      }).catch(fail);
    };
    search.addEventListener('input', debounce(function () { load(0); }, 300));
    status.addEventListener('change', function () { load(0); });
    load(0);
  }

  // ─── Alarmlar ───
  function pageAlarms(q) {
    var main = shell('alarms', 'Alarmlar', 'Kodlu bildirimler ve robot arızaları');
    var days = h('select', null, [[1, 'Son 24 saat'], [7, 'Son 7 gün'], [30, 'Son 30 gün'], [90, 'Son 90 gün']].map(function (o) { return h('option', { value: o[0], selected: String(q.days || 7) === String(o[0]) }, o[1]); }));
    var code = h('select', null, [h('option', { value: '' }, 'Tüm kodlar')].concat(Object.keys(ALARMS).map(function (c) { return h('option', { value: c, selected: q.code === c }, c + ' · ' + ALARMS[c]); })));
    var box = h('div', { class: 'card' });
    main.appendChild(h('div', { class: 'toolbar' }, days, code));
    main.appendChild(box);
    var load = function (p) {
      clear(box); loading(box);
      call('GET', '/alarms?' + new URLSearchParams({ days: days.value, code: code.value, page: p || 0 })).then(function (d) {
        clear(box).appendChild(table([
          { t: 'Zaman', v: function (a) { return [h('div', null, fmtDate(a.createdAt, true)), h('div', { class: 'muted small' }, ago(a.createdAt))]; } },
          { t: 'Kod', v: function (a) { return a.code ? pill(a.code, a.code[0] === 'M' ? 'blue' : 'red') : pill(a.type, 'grey'); } },
          { t: 'Alarm', v: function (a) { return [h('div', { class: 'b' }, a.title), h('div', { class: 'muted small' }, a.body)]; } },
          { t: 'Robot', m: 1, v: function (a) { return a.robot ? [h('div', null, a.robot.name), h('div', { class: 'muted small' }, a.robot.serialNumber)] : '—'; } },
          { t: 'Çiftlik', v: function (a) { return a.owner ? h('a', { href: '#/users/' + a.owner.id }, a.owner.name) : '—'; } },
        ], d.alarms));
        box.appendChild(pager(d, load));
      }).catch(fail);
    };
    days.addEventListener('change', function () { load(0); });
    code.addEventListener('change', function () { load(0); });
    load(0);
  }

  // ─── Turlar ───
  function pageRuns(q) {
    var main = shell('runs', 'Turlar', 'Tamamlanan temizlik turları');
    var days = h('select', null, [[1, 'Son 24 saat'], [7, 'Son 7 gün'], [30, 'Son 30 gün'], [90, 'Son 90 gün']].map(function (o) { return h('option', { value: o[0], selected: String(q.days || 7) === String(o[0]) }, o[1]); }));
    var box = h('div', { class: 'card' });
    main.appendChild(h('div', { class: 'toolbar' }, days));
    main.appendChild(box);
    var load = function (p) {
      clear(box); loading(box);
      call('GET', '/runs?' + new URLSearchParams({ days: days.value, page: p || 0 })).then(function (d) {
        clear(box).appendChild(table([
          { t: 'Bitiş', v: function (r) { return fmtDate(r.finishedAt, true); } },
          { t: 'Çiftlik', v: function (r) { return r.owner; } },
          { t: 'Robot', v: function (r) { return [h('div', null, r.robot), h('div', { class: 'muted small' }, r.barn)]; } },
          { t: 'Alan', v: function (r) { return fmtN(r.areaM2) + ' m²'; } },
          { t: 'Süre', m: 1, v: function (r) { return fmtN(r.durationMin) + ' dk'; } },
          { t: 'Atık', m: 1, v: function (r) { return fmtN(r.wasteKg) + ' kg'; } },
          { t: 'Amonyak', m: 1, v: function (r) { return r.ammonia == null ? '—' : r.ammonia + ' ppm'; } },
        ], d.runs));
        box.appendChild(pager(d, load));
      }).catch(fail);
    };
    days.addEventListener('change', function () { load(0); });
    load(0);
  }

  // ─── Yazılım güncelleme (OTA) ───
  // target: { robotIds: [...] } | { fromVersion } | { all: true }
  function otaModal(target, label, done) {
    call('GET', '/firmware').then(function (d) {
      var sel = h('select', { style: 'width:100%' },
        d.files.map(function (f) { return h('option', { value: f.id }, f.version + ' · ' + fmtDate(f.uploadedAt) + (f.notes ? ' · ' + f.notes.slice(0, 40) : '')); })
          .concat([h('option', { value: '__url' }, 'Harici adres (https://…/dosya.bin)')]));
      var url = h('input', { type: 'url', placeholder: 'https://…/ahirbot.bin', style: 'display:none' });
      var online = h('input', { type: 'checkbox', style: 'height:auto;width:auto;margin:0' });
      var same = h('input', { type: 'checkbox', style: 'height:auto;width:auto;margin:0' });
      var many = !target.robotIds;
      sel.addEventListener('change', function () { url.style.display = sel.value === '__url' ? '' : 'none'; });
      if (!d.files.length) { sel.value = '__url'; url.style.display = ''; }
      var m = modal('Yazılım güncelle', [
        h('p', { class: 'muted', style: 'margin-top:0' }, label + ' dosyayı indirir, kurar ve yeniden başlar. Temizlik yapan robot turu yarıda bırakır.'),
        h('label', { class: 'small b' }, 'Yazılım'), sel, url,
        many && h('label', { class: 'row small', style: 'margin-top:10px' }, online, 'Sadece şu an çevrimiçi olanlar'),
        many && h('label', { class: 'row small', style: 'margin-top:6px' }, same, 'Zaten bu sürümde olanlara da gönder'),
      ], [
        h('button', { class: 'btn light', onclick: function () { m.remove(); } }, 'Vazgeç'),
        h('button', { class: 'btn', onclick: function () {
          var body = Object.assign({}, target, { onlyOnline: online.checked, includeSame: same.checked || !many });
          if (sel.value === '__url') {
            if (!/^https?:\/\/\S+$/i.test(url.value.trim())) return toast('Geçerli bir .bin adresi girin', true);
            body.url = url.value.trim();
          } else body.firmwareId = sel.value;
          m.remove();
          call('POST', '/ota', body).then(function (r) {
            toast(r.count ? r.count + ' robota güncelleme gönderildi' : 'Uygun robot yok (hepsi zaten bu sürümde ya da çevrimdışı)', !r.count);
            if (done) done();
          }).catch(fail);
        } }, 'Gönder'),
      ]);
    }).catch(fail);
  }

  // .bin içindeki "AHIRBOT_FW=v0.5.0" etiketini tarayıcıda okur (sürüm kutusu otomatik dolar)
  function readFwTag(file) {
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var tag = 'AHIRBOT_FW=';
      if (b[0] !== 0xE9) return { notEsp: true };
      outer: for (var i = 0; i < b.length - tag.length; i++) {
        for (var j = 0; j < tag.length; j++) if (b[i + j] !== tag.charCodeAt(j)) continue outer;
        var v = '';
        for (var k = i + tag.length; k < b.length && b[k] !== 0 && v.length < 32; k++) v += String.fromCharCode(b[k]);
        return { version: v };
      }
      return {};
    });
  }

  function pageOta() {
    var main = shell('ota', 'Yazılım güncelleme (OTA)', 'ESP32 .bin dosyasını yükleyin, robotlara gönderin');
    var filesBox = h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'Yüklenen dosyalar'));
    var statusBox = h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'Güncelleme durumu (son 14 gün)'));

    // Yükleme kartı
    var file = h('input', { type: 'file', accept: '.bin,application/octet-stream', style: 'width:100%;padding-top:7px' });
    var version = h('input', { placeholder: 'Sürüm (ör. v0.5.0)', style: 'width:100%' });
    var notes = h('input', { placeholder: 'Not (isteğe bağlı): ne değişti?', maxlength: 500, style: 'width:100%' });
    var info = h('div', { class: 'small muted', style: 'min-height:18px;margin-top:4px' });
    var btn = h('button', { class: 'btn', style: 'margin-top:12px' }, 'Yükle');
    file.addEventListener('change', function () {
      info.textContent = ''; info.style.color = '';
      var f = file.files[0];
      if (!f) return;
      readFwTag(f).then(function (r) {
        if (r.notEsp) { info.textContent = 'Bu dosya ESP32 yazılımı gibi görünmüyor. "…ino.bin" dosyasını seçin.'; info.style.color = 'var(--red)'; return; }
        if (r.version) { version.value = r.version; info.textContent = fmtSize(f.size) + ' · dosyadaki sürüm: ' + r.version; }
        else info.textContent = fmtSize(f.size) + ' · sürüm etiketi bulunamadı, elle yazın';
      });
    });
    btn.addEventListener('click', function () {
      var f = file.files[0];
      if (!f) return toast('Bir .bin dosyası seçin', true);
      if (f.size > 4 * 1048576) return toast('Dosya 4 MB’dan büyük olamaz', true);
      btn.disabled = true; btn.textContent = 'Yükleniyor…';
      upload('/firmware', f, { 'X-Firmware-Version': version.value.trim(), 'X-Notes': encodeURIComponent(notes.value.trim()), 'X-Filename': encodeURIComponent(f.name) })
        .then(function (r) {
          toast(r.version + ' yüklendi');
          if (r.warning) toast(r.warning, true);
          file.value = ''; version.value = ''; notes.value = ''; info.textContent = '';
          loadFiles();
        }).catch(fail).finally(function () { btn.disabled = false; btn.textContent = 'Yükle'; });
    });
    main.appendChild(h('div', { class: 'card', style: 'max-width:620px' },
      h('h3', null, 'Yeni yazılım yükle'),
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Arduino IDE: Taslak > Derlenmiş Binary’i Dışa Aktar. Taslak klasöründe çıkan "ahirbot_esp32_http.ino.bin" dosyasını seçin (bootloader, partitions ya da merged değil). Dosya veritabanında saklanır; robotlar kendi anahtarlarıyla indirir.'),
      file, info, h('div', { class: 'grid g2', style: 'margin-top:8px' }, version, notes), btn));
    main.appendChild(filesBox);
    main.appendChild(statusBox);

    function loadFiles() {
      clear(filesBox).appendChild(h('h3', null, 'Yüklenen dosyalar'));
      var l = loading(filesBox);
      call('GET', '/firmware').then(function (d) {
        l.remove();
        filesBox.appendChild(table([
          { t: 'Sürüm', v: function (f) { return [h('div', { class: 'b' }, f.version), h('div', { class: 'muted small' }, f.filename)]; } },
          { t: 'Boyut', m: 1, v: function (f) { return fmtSize(f.size); } },
          { t: 'Yüklendi', m: 1, v: function (f) { return [h('div', null, fmtDate(f.uploadedAt, true)), h('div', { class: 'muted small' }, f.uploadedBy || '')]; } },
          { t: 'Bu sürümdeki robot', v: function (f) { return f.robots; } },
          { t: 'Not', m: 1, v: function (f) { return h('span', { class: 'muted small' }, f.notes || '—'); } },
          { t: '', v: function (f) {
            return h('div', { class: 'row acts' },
              h('button', { class: 'btn sm', onclick: function () { sendModal(f, d.versions); } }, 'Gönder'),
              h('button', { class: 'btn red sm', onclick: function () {
                confirmBox('Dosyayı sil', f.version + ' silinsin mi? Bu dosyayı henüz indirmemiş robotlar güncellenemez.', 'Sil', true)
                  .then(function (ok) { if (ok) call('DELETE', '/firmware/' + f.id).then(function () { toast('Silindi'); loadFiles(); }).catch(fail); });
              } }, 'Sil'));
          } },
        ], d.files));
      }).catch(fail);
    }

    // Toplu gönderme: tüm robotlar ya da belirli sürümdekiler
    function sendModal(f, versions) {
      var target = h('select', { style: 'width:100%' }, [h('option', { value: '__all' }, 'Tüm robotlar')]
        .concat(versions.filter(function (v) { return v.version !== f.version; }).map(function (v) { return h('option', { value: v.version }, v.version + ' sürümündekiler (' + v.n + ')'); })));
      var online = h('input', { type: 'checkbox', checked: true, style: 'height:auto;width:auto;margin:0' });
      var m = modal(f.version + ' gönder', [
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Robotlar bir sonraki bağlantılarında (en geç birkaç saniye) dosyayı indirir. Zaten ' + f.version + ' olanlara gönderilmez.'),
        h('label', { class: 'small b' }, 'Hangi robotlar'), target,
        h('label', { class: 'row small', style: 'margin-top:10px' }, online, 'Sadece şu an çevrimiçi olanlar'),
        h('p', { class: 'small muted' }, 'Tek bir robota göndermek için Robotlar sayfasındaki OTA düğmesini kullanın.'),
      ], [
        h('button', { class: 'btn light', onclick: function () { m.remove(); } }, 'Vazgeç'),
        h('button', { class: 'btn', onclick: function () {
          var body = { firmwareId: f.id, onlyOnline: online.checked };
          if (target.value === '__all') body.all = true; else body.fromVersion = target.value;
          m.remove();
          call('POST', '/ota', body).then(function (r) {
            toast(r.count ? r.count + ' robota gönderildi' : 'Uygun robot yok (hepsi güncel ya da çevrimdışı)', !r.count);
            loadStatus();
          }).catch(fail);
        } }, 'Gönder'),
      ]);
    }

    function loadStatus() {
      call('GET', '/ota/status').then(function (d) {
        clear(statusBox).appendChild(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, h('h3', { style: 'margin:0' }, 'Güncelleme durumu (son 14 gün)'), h('span', { class: 'muted small' }, 'her 10 sn yenilenir')));
        statusBox.appendChild(table([
          { t: 'Robot', v: function (r) { return [h('div', { class: 'b' }, h('span', { class: 'dot' + (r.status !== 'offline' ? ' on' : '') }), r.name), h('div', { class: 'muted small' }, r.serialNumber)]; } },
          { t: 'Sahip', m: 1, v: function (r) { return r.owner ? h('a', { href: '#/users/' + r.owner.id }, r.owner.name) : '—'; } },
          { t: 'Durum', v: function (r) { return [otaPill(r.ota), r.ota.detail ? h('div', { class: 'small', style: 'color:var(--red)' }, r.ota.detail) : null]; } },
          { t: 'Sürüm', v: function (r) { return (r.ota.from || '?') + ' → ' + (r.ota.version || '?'); } },
          { t: 'Şu an', m: 1, v: function (r) { return r.firmwareVersion || '—'; } },
          { t: 'Zaman', m: 1, v: function (r) { return ago(r.ota.at); } },
          { t: '', v: function (r) {
            return r.ota.state === 'queued' ? h('button', { class: 'btn light sm', onclick: function () {
              call('POST', '/robots/' + r.id + '/ota-cancel').then(function () { toast('İptal edildi'); loadStatus(); }).catch(fail);
            } }, 'İptal') : null;
          } },
        ], d.robots));
      }).catch(fail);
    }

    loadFiles();
    loading(statusBox);
    loadStatus();
    var timer = setInterval(function () {
      if (location.hash.indexOf('#/ota') !== 0) return clearInterval(timer);
      loadStatus();
    }, 10000);
  }

  // ─── Uygulama hataları ───
  function kindPill(e) { var k = KIND[e.kind] || [e.kind, 'grey']; return pill(k[0], k[1]); }

  function pageErrors(q) {
    var main = shell('errors', 'Hatalar', 'Uygulama çökmeleri ve sunucu hataları (aynı hata tek satırda toplanır)');
    var search = h('input', { type: 'search', placeholder: 'Hata mesajı, e-posta ya da sürüm ara', value: q.q || '' });
    var status = h('select', null, [['open', 'Açık'], ['resolved', 'Çözüldü'], ['all', 'Tümü']].map(function (o) { return h('option', { value: o[0], selected: (q.status || 'open') === o[0] }, o[1]); }));
    var source = h('select', null, [['', 'Uygulama + sunucu'], ['app', 'Uygulama'], ['server', 'Sunucu']].map(function (o) { return h('option', { value: o[0], selected: q.source === o[0] }, o[1]); }));
    var sort = h('select', null, [['last', 'En son görülen'], ['count', 'En çok tekrar eden']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    var purge = h('button', { class: 'btn light', onclick: function () {
      confirmBox('Çözülenleri temizle', 'Çözüldü olarak işaretlenen tüm hata kayıtları silinsin mi?', 'Sil', true).then(function (ok) {
        if (ok) call('POST', '/errors/purge-resolved').then(function (r) { toast(r.count + ' kayıt silindi'); load(0); }).catch(fail);
      });
    } }, 'Çözülenleri temizle');
    var box = h('div', { class: 'card' });
    main.appendChild(h('div', { class: 'toolbar' }, search, status, source, sort, purge));
    main.appendChild(box);
    var load = function (p) {
      clear(box); loading(box);
      call('GET', '/errors?' + new URLSearchParams({ q: search.value, status: status.value, source: source.value, sort: sort.value, page: p || 0 })).then(function (d) {
        clear(box).appendChild(table([
          { t: 'Hata', v: function (e) { return [h('div', { class: 'b', style: 'white-space:normal;word-break:break-word' }, e.name + ': ' + e.message.slice(0, 160)), h('div', { class: 'row small', style: 'margin-top:3px' }, kindPill(e), e.fatalCount ? pill('çöktü ×' + e.fatalCount, 'red') : null, e.resolved ? pill('Çözüldü') : null)]; } },
          { t: 'Tekrar', v: function (e) { return h('b', null, fmtN(e.count)); } },
          { t: 'Kullanıcı', m: 1, v: function (e) { return e.users; } },
          { t: 'Son sürüm', m: 1, v: function (e) { return [h('div', null, e.lastAppVersion || '—'), h('div', { class: 'muted small' }, e.lastPlatform || '')]; } },
          { t: 'Son görülme', v: function (e) { return [h('div', null, ago(e.lastAt)), h('div', { class: 'muted small' }, 'ilk: ' + fmtDate(e.firstAt))]; } },
        ], d.errors, function (e) { location.hash = '#/errors/' + e.id; }));
        box.appendChild(pager(d, load));
      }).catch(fail);
    };
    search.addEventListener('input', debounce(function () { load(0); }, 300));
    [status, source, sort].forEach(function (x) { x.addEventListener('change', function () { load(0); }); });
    load(0);
  }

  function pageError(id) {
    var main = shell('errors', 'Hata', '');
    var l = loading(main);
    call('GET', '/errors/' + id).then(function (e) {
      l.remove();
      main.querySelector('h1').textContent = e.name;
      main.querySelector('.sub').textContent = e.message;
      main.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn' + (e.resolved ? ' light' : ''), onclick: function () {
          call('PATCH', '/errors/' + id, { resolved: !e.resolved }).then(function () { toast(e.resolved ? 'Yeniden açıldı' : 'Çözüldü olarak işaretlendi'); pageError(id); }).catch(fail);
        } }, e.resolved ? 'Yeniden aç' : 'Çözüldü olarak işaretle'),
        h('button', { class: 'btn red', onclick: function () {
          confirmBox('Kaydı sil', 'Bu hata kaydı silinsin mi? Tekrar olursa yeniden açılır.', 'Sil', true).then(function (ok) {
            if (ok) call('DELETE', '/errors/' + id).then(function () { toast('Silindi'); location.hash = '#/errors'; }).catch(fail);
          });
        } }, 'Sil'),
        h('a', { class: 'btn light', href: '#/errors', style: 'display:inline-flex;align-items:center' }, '‹ Listeye dön')));
      main.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'kv' },
        h('div', null, 'Tür'), h('div', { class: 'row' }, kindPill(e), pill(e.source === 'server' ? 'Sunucu' : 'Uygulama', 'grey'), e.resolved ? pill('Çözüldü') : pill('Açık', 'amber')),
        h('div', null, 'Tekrar'), h('div', null, fmtN(e.count) + ' kez' + (e.fatalCount ? ' (' + e.fatalCount + ' kez uygulamayı kapattı)' : '')),
        h('div', null, 'Etkilenen kullanıcı'), h('div', null, e.users),
        h('div', null, 'İlk görülme'), h('div', null, fmtDate(e.firstAt, true)),
        h('div', null, 'Son görülme'), h('div', null, fmtDate(e.lastAt, true) + ' · ' + ago(e.lastAt)),
        h('div', null, 'Son sürüm'), h('div', null, (e.lastAppVersion || '—') + ' · ' + (e.lastPlatform || '')))));
      main.appendChild(h('h3', { style: 'margin:20px 0 10px' }, 'Son örnekler (' + e.samples.length + ')'));
      e.samples.forEach(function (x, i) {
        var dev = [x.platform, x.osVersion, x.model].filter(Boolean).join(' · ');
        main.appendChild(h('details', { class: 'card sample', open: i === 0 },
          h('summary', null, h('b', null, fmtDate(x.at, true)), ' ', x.fatal ? pill('çöktü', 'red') : null, ' ',
            h('span', { class: 'muted' }, [x.user ? x.user.name + ' (' + x.user.email + ')' : 'giriş yapılmamış', dev, x.appVersion ? 'sürüm ' + x.appVersion + (x.buildVersion ? ' (' + x.buildVersion + ')' : '') : '', x.screen ? 'ekran: ' + x.screen : ''].filter(Boolean).join(' · '))),
          x.extra ? h('p', { class: 'small muted' }, x.extra) : null,
          x.stack ? [h('div', { class: 'small b', style: 'margin-top:10px' }, 'Yığın (stack)'), h('pre', null, x.stack)] : null,
          x.componentStack ? [h('div', { class: 'small b', style: 'margin-top:10px' }, 'Bileşen ağacı'), h('pre', null, x.componentStack)] : null));
      });
    }).catch(function (err) { l.textContent = err.message; });
  }

  // ─── Yönlendirme ───
  function route() {
    if (!sessionStorage.getItem(TOKEN_KEY)) return renderLogin();
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var path = parts[0].split('/');
    var q = Object.fromEntries(new URLSearchParams(parts[1] || ''));
    var go = function () {
      if (path[0] === 'users' && path[1]) return pageUser(path[1]);
      if (path[0] === 'users') return pageUsers(q);
      if (path[0] === 'robots') return pageRobots(q);
      if (path[0] === 'alarms') return pageAlarms(q);
      if (path[0] === 'runs') return pageRuns(q);
      if (path[0] === 'ota') return pageOta();
      if (path[0] === 'errors' && path[1]) return pageError(path[1]);
      if (path[0] === 'errors') return pageErrors(q);
      return pageOverview();
    };
    if (me) return go();
    call('GET', '/me').then(function (m) { me = m; go(); }).catch(function () {});
  }

  window.addEventListener('hashchange', route);
  route();
})();
