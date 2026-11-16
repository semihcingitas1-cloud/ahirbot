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
| `GET/POST /barns` | Ahırlar |
| `GET /robots`, `POST /robots` (eşleştirme, cihaz anahtarı döner) | Robotlar |
| `POST /robots/:id/command` `{ command: start\|pause\|stop\|dock\|empty\|drive }` | Komut kuyruğa girer |
| `PUT /robots/:id/settings` | Mod, hız, baskı, hayvan algılama |
| `GET /tasks`, `POST /tasks`, `PUT /program` | Takvim |
| `GET /reports?range=week\|month\|year` | Raporlar |
| `GET /notifications`, `POST /notifications/read-all` | Bildirimler |

## Robot WebSocket geçidi (ESP32 buraya bağlanır)

Vercel WebSocket tutamaz; bu yüzden `ws-gateway.js` ayrı bir serviste sürekli çalışır (Render ücretsiz plan, `render.yaml` hazır).
Uygulama yine Vercel API'yi kullanır. İkisi aynı MongoDB'ye bağlanır: uygulamanın komutu `pendingCommands`'a yazılır,
geçit saniyede bir bakıp bağlı robota anında iletir.

Kurulum (Render): New → Blueprint → bu repo → `MONGO_URI` gir. Adres: `wss://<servis>.onrender.com/ws`
Yerelde: `MONGO_URI=... npm run ws` → `ws://<bilgisayar IP>:8080/ws`

Bağlantı başlıkları: `X-Serial`, `X-Device-Key` (yanlışsa 401).

| Robot → sunucu | |
|---|---|
| `{"type":"hello", ...telemetri, firmwareVersion}` | bağlanınca bir kez |
| `{"type":"telemetry", status, progress, battery, tank, water, position{x,y}, taskId ...}` | çalışırken 2 sn, beklerken 15 sn |
| `{"type":"run", area, wasteKg, areaM2, durationMin, ammonia, hygiene, taskId}` | tur bitince (rapor) |
| `{"type":"event", kind:"blocked\|error\|tank\|info", title, body}` | bildirim |
| `{"type":"ack", command, ok, reason}` | komut uygulandı / reddedildi |

| Sunucu → robot | |
|---|---|
| `{"type":"welcome"\|"sync", settings, tasks, localTime}` | hello/telemetri cevabı |
| `{"type":"command", command, payload}` | `start, pause, stop, dock, empty, drive{dir}, ota{url}` |

Not: Render ücretsiz planda servis trafik yoksa uyuyabilir; uyanması ~1 dk sürer, ESP32 kendiliğinden yeniden bağlanır.

## Robot (cihaz) HTTP API'si (yedek yol)

WebSocket kullanamayan cihazlar için. Aynı mantık (`lib/device.js`) kullanılır.
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
