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
  var NAV = [['overview', 'Genel bakış'], ['users', 'Kullanıcılar'], ['robots', 'Robotlar'], ['alarms', 'Alarmlar'], ['runs', 'Turlar'], ['ota', 'Yazılım güncelleme']];

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
        promptBox('Yazılım güncelle', r.name + ' (şu an ' + (r.firmwareVersion || 'bilinmiyor') + ') bu .bin dosyasını indirip yeniden başlar.', 'https://…/ahirbot.bin')
          .then(function (url) { if (url) cmd('ota', { url: url }, 'Güncelleme gönderildi'); });
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
      { t: 'Yazılım', m: 1, v: function (r) { return r.firmwareVersion || '—'; } },
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

  // ─── Toplu yazılım güncellemesi ───
  function pageOta() {
    var main = shell('ota', 'Yazılım güncelleme', 'Birden fazla robota aynı anda OTA gönderin');
    var l = loading(main);
    call('GET', '/stats').then(function (s) {
      l.remove();
      var url = h('input', { type: 'url', placeholder: 'https://…/ahirbot-v0.5.0.bin', style: 'width:100%' });
      var target = h('select', { style: 'width:100%' }, [h('option', { value: '' }, 'Sürüm seçin…'), h('option', { value: '__all' }, 'Tüm robotlar (' + s.robots.total + ')')]
        .concat(s.robots.firmware.map(function (f) { return h('option', { value: f.version }, f.version + ' sürümündekiler (' + f.n + ')'); })));
      var online = h('input', { type: 'checkbox', checked: true, style: 'height:auto;min-width:0' });
      var btn = h('button', { class: 'btn', style: 'margin-top:14px' }, 'Güncellemeyi gönder');
      btn.addEventListener('click', function () {
        if (!/^https?:\/\/\S+$/i.test(url.value.trim())) return toast('Geçerli bir .bin adresi girin', true);
        if (!target.value) return toast('Hangi robotlara gideceğini seçin', true);
        var body = { url: url.value.trim(), onlyOnline: online.checked };
        if (target.value === '__all') body.all = true; else body.fromVersion = target.value;
        confirmBox('Toplu güncelleme', 'Seçili robotlar dosyayı indirip yeniden başlayacak. Temizlik yapan robotlar turu yarıda bırakır. Devam edilsin mi?', 'Gönder', true).then(function (ok) {
          if (!ok) return;
          btn.disabled = true;
          call('POST', '/ota', body).then(function (r) { toast(r.count + ' robota güncelleme gönderildi'); }).catch(fail).finally(function () { btn.disabled = false; });
        });
      });
      main.appendChild(h('div', { class: 'card', style: 'max-width:560px' },
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Arduino’da "Derlenmiş Binary’i Dışa Aktar" ile çıkan .bin dosyasını herkese açık bir adrese (ör. GitHub Releases) yükleyin. Robot dosyayı indirir, kurar ve yeniden başlar; sonuç kullanıcının bildirimlerine düşer (başarısızsa E08).'),
        h('label', { class: 'small b' }, 'Dosya adresi'), url,
        h('label', { class: 'small b', style: 'display:block;margin-top:12px' }, 'Hangi robotlar'), target,
        h('label', { class: 'row small', style: 'margin-top:12px' }, online, 'Sadece şu an çevrimiçi olanlar'),
        btn));
    }).catch(fail);
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
      return pageOverview();
    };
    if (me) return go();
    call('GET', '/me').then(function (m) { me = m; go(); }).catch(function () {});
  }

  window.addEventListener('hashchange', route);
  route();
})();
