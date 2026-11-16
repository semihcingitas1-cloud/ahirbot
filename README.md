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

## Robot (cihaz) API'si

Vercel sürekli açık bağlantı tutamadığı için (MQTT broker / socket.io çalışmaz) robot HTTP ile konuşur.
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
