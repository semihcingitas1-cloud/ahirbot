# AhırBot Sunucusu (Vercel)

AhırBot mobil uygulamasının API'si. mqttserver projesindeki Express + MongoDB + JWT + e-posta doğrulama yapısı korunarak Vercel'e uygun (serverless) hale getirildi.

## Vercel'e kurulum

1. Bu klasörü bir GitHub reposuna yükleyin (`.env` dosyasını **yüklemeyin**).
2. Vercel > Add New > Project > repoyu seçin. Framework: **Other**. Build ayarlarına dokunmayın.
3. Settings > Environment Variables bölümüne `.env.example` içindeki değişkenleri girin:
   - `MONGO_URI`: mevcut Atlas cluster'ınızı kullanabilirsiniz, sonuna `/ahirbot` yazarak ayrı veritabanı açın.
   - `JWT_SECRET`: uzun rastgele bir değer.
   - `APP_URL`: Vercel'in verdiği adres (ör. `https://ahirbot-server.vercel.app`).
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: e-posta için. Gmail'de normal şifre çalışmaz, "Uygulama şifresi" gerekir.
4. MongoDB Atlas > Network Access: `0.0.0.0/0` ekleyin (Vercel'in IP'si sabit değil).
5. Deploy. `https://<adres>/health` → `{"ok":true}` dönmeli.

Yerelde: `cp .env.example .env`, değerleri doldurun, `npm install && npm run dev` (http://localhost:4000).

## Uygulama API'si (Authorization: Bearer <token>)

| | |
|---|---|
| `POST /register`, `POST /login`, `POST /resend-verification`, `POST /forgotPassword`, `GET /profile` | Hesap |
| `GET /verify-email/:token`, `GET /reset/:token` | E-postadaki bağlantıların açtığı sayfalar |
| `GET/POST /barns`, `PUT/DELETE /barns/:id` (`layout: {corridors, stalls, dock{x,y}, dump{x,y}}`) | Ahırlar ve ahır planı |
| `GET /robots`, `POST /robots` (eşleştirme, cihaz anahtarı döner; aynı robot tekrar eklenirse yeni anahtar) | Robotlar |
| `POST /robots/:id/command` `{ command: start\|pause\|stop\|dock\|empty\|drive\|ota }` | Komut kuyruğa girer (`ota`: `payload.url` .bin adresi) |
| `PUT /robots/:id/settings` | Mod, hız, baskı, hayvan algılama |
| `GET /tasks`, `POST /tasks`, `PUT /program` | Takvim |
| `GET /reports?range=week\|month\|year` | Raporlar |
| `GET /notifications`, `POST /notifications/read-all` | Bildirimler |
| `POST /notifications/register-token`, `POST /notifications/unregister-token` | Telefonun Expo push token'ı |
| `GET /team`, `POST /team/invites`, `PATCH/DELETE /team/members/:id`, `GET /team/invites/mine`, `POST /team/invites/:id/respond`, `POST /team/leave` | Çiftlik ekibi |

### Roller
- **Sahip**: her şey (robot ekleme/silme, anahtar, ahır silme, ekip).
- **Yönetici**: ahır planı, görev, program, robot ayarları, OTA.
- **Çalışan**: izleme, başlat/durdur/sür, bildirimler.

Ekip üyesi sahibin çiftliğini görür (`req.farmId`). Robot bildirimleri sahibe ve tüm aktif üyelere push olarak gider (Expo Push, ücretsiz; ek ayar gerekmez).

## Robot (cihaz) API'si

Vercel sürekli açık bağlantı (WebSocket/MQTT) tutamadığı için robot HTTP ile konuşur: çalışırken 2 sn, beklerken 5 sn'de bir telemetri gönderir, cevapta komutlarını alır. ESP32 test yazılımı: `ahirbot_esp32_http.ino`.
Başlıklar: `X-Serial: <seri no>`, `X-Device-Key: <anahtar>` (uygulamada robot eklenince bir kez gösterilir).

- `POST /device/telemetry` – 2-5 saniyede bir. Gövde: `status, progress, corridor, battery, tank, water, cleanedArea, ammonia, speed, etaMin, position{x,y}, taskId`. Cevap: `{ commands, settings, tasks }` → robot komutları uygular.
- `POST /device/run` – tur bitince: `area (walkway|milking|calf), wasteKg, areaM2, durationMin, ammonia, hygiene, taskId`. Raporlar buradan hesaplanır.
- `POST /device/event` – serbest bildirim: `type, title, body`.

Durum `blocked`/`error` olunca, hazne %85'i veya amonyak 20 ppm'i geçince bildirim otomatik oluşur. 2 dakika telemetri gelmezse robot "çevrimdışı" görünür.

### Robot olmadan deneme

```bash
API=https://<adres> SERIAL=<seri no> KEY=<anahtar> node tools/robot-simulator.js
```
Sahte robot telemetri gönderir, uygulamadan gelen başlat/duraklat/boşalt komutlarını uygular ve tur bitince rapora yazar.

## Yönetici paneli (/admin)

`https://<sunucu-adresiniz>/admin` adresinden açılır. Giriş, normal AhırBot hesabıyla yapılır ama sadece yöneticiler girebilir:

1. Önce uygulamadan kendinize bir hesap açın (e-postanız doğrulanmış olsun).
2. Vercel > Settings > Environment Variables'a `ADMIN_EMAILS=sizin@epostaniz.com` ekleyip yeniden deploy edin.
3. `/admin` sayfasında aynı e-posta ve şifreyle girin. Başka birini panelden "Yönetici yap" ile ekleyebilirsiniz.

Panelde: genel bakış (kullanıcı, çevrimiçi robot, son 7 gün tur, bakım bekleyen, alarmlar, yazılım sürümleri), kullanıcılar (ara, askıya al / aç, yönetici yap, e-postayı doğrulanmış say, robotları, ahırları, ekibi), robotlar (durdur, şarja gönder, OTA, anahtar yenile, sil), alarmlar (koda göre), turlar ve toplu yazılım güncellemesi.

Güvenlik: panel token'ı 8 saat geçerlidir ve sekme kapanınca silinir; uygulama token'ı panele giremez. 15 dakikada 8 hatalı girişte e-posta geçici olarak kilitlenir. Askıya alınan kullanıcı uygulamaya giremez, açık oturumları da reddedilir (robotları çalışmaya devam eder). Yönetici işlemleri Vercel > Logs'a "ADMIN …" satırı olarak yazılır.
