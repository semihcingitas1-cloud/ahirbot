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
- `POST /device/ota` – güncelleme durumu: `state (downloading|success|failed|no_update), version, from, detail`. Başarı/başarısızlık bildirimi buradan oluşur (başarısızsa E08).
- `GET /device/firmware/:id` – panelden yüklenen .bin dosyası (sadece kayıtlı robotlar indirebilir; `x-MD5` başlığı ile).

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


## Şifremi unuttum ve hesap silme

- `POST /forgotPassword { email }` → e-postaya 6 haneli kod + tarayıcı bağlantısı gider (30 dk geçerli, dakikada en çok 1 e-posta).
- `POST /reset-password/check { email, code }` → kod doğru mu (5 hatalı denemede kod iptal olur).
- `POST /reset-password/code { email, code, password }` → şifre değişir, cevapta token gelir (uygulama doğrudan giriş yapar).
- `DELETE /account { password }` → hesabı ve çiftliğe ait her şeyi siler (robotlar, ahırlar, görevler, turlar, bildirimler, ekip, davetler). Başka bir çiftliğin ekibindeyse sadece üyeliği silinir. Hata kayıtlarındaki kullanıcı bilgisi kaldırılır. Silindiğine dair e-posta gider.
- `https://<sunucu>/delete-account` → aynı işlemin tarayıcı formu. **Google Play Console > Uygulama içeriği > Veri güvenliği > "Hesap silme bağlantısı"** alanına bu adresi yazın (App Store için uygulama içindeki Ayarlar > Hesabı sil yeterli).

## Hata kaydı (yönetici paneli > Hatalar)

Uygulama yakalanmamış bir hata aldığında (çökme, ekran çizilirken hata, yakalanmamış promise) `POST /client-errors` ile sunucuya gönderir. Sunucunun kendi 500 hataları da aynı yere yazılır. Aynı hata tek satırda toplanır (tekrar sayısı, etkilenen kullanıcı, son 20 örnek: cihaz, sürüm, ekran, stack). "Çözüldü" işaretlenen hata tekrar olursa yeniden açılır. Expo Go'dan gelen hatalar `1.0.0-dev` sürümüyle görünür. Uygulamada Ayarlar'ın en altındaki sürüm yazısına 1,5 sn basılı tutunca test hatası gönderilir.

## Yazılım güncelleme (OTA)

Panel > Yazılım (OTA): Arduino'da **Taslak > Derlenmiş Binary'i Dışa Aktar** ile çıkan `ahirbot_esp32_http.ino.bin` dosyasını yükleyin. Dosya MongoDB'de (GridFS, `firmware.files` / `firmware.chunks`) saklanır; ek servis veya ücret yok. Sürüm, .bin içindeki `AHIRBOT_FW=` etiketinden otomatik okunur (yazılımda `FIRMWARE_VERSION`'ı her seferinde artırın).

Gönder: tüm robotlara, belirli sürümdekilere ya da Robotlar sayfasından tek robota. Zaten o sürümde olanlara gönderilmez. Robot bir sonraki bağlantısında dosyayı kendi anahtarıyla indirir, MD5'i kontrol eder, kurar ve yeniden başlar. Durum sayfada canlı görünür: Kuyrukta → Robot aldı → İndiriyor → Güncellendi / Başarısız. Kuyruktaki güncelleme iptal edilebilir.

Sınır: Vercel istek/cevap gövdesi en çok 4,5 MB olduğu için .bin en çok 4 MB olabilir (ESP32 "Minimal SPIFFS" uygulama bölümü zaten 1,9 MB). `vercel.json`'da fonksiyon süresi 60 sn'ye çıkarıldı (ücretsiz planda izin verilen üst sınır).
