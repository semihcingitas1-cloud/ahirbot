const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const MAX_ATTEMPTS = 3;

let transporter;

const getTransporter = () => {

    if (transporter) return transporter;

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {

        throw new Error("SMTP ayarları eksik: SMTP_HOST, SMTP_USER ve SMTP_PASS .env içinde tanımlı olmalı.");
    }

    const port = Number(SMTP_PORT || 587);

    transporter = nodemailer.createTransport({

        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        pool: false, // serverless: her çağrıda yeni bağlantı
        maxConnections: 2,
        maxMessages: 100,
    });

    return transporter;
};

// HTML'den düz metin alternatifi üretir (text kısmı olmayan mailler spam puanını artırır)
const htmlToText = (html = "") =>
    html
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
        .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

// Geçici hatalarda (bağlantı kopması, SMTP 4xx) tekrar denenir; kalıcı hatalarda denenmez
const isTransient = (err) =>
    (err.responseCode >= 400 && err.responseCode < 500) ||
    ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET"].includes(err.code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * options:
 *   email | to      alıcı (string veya dizi)
 *   subject         konu
 *   message | html  HTML içerik
 *   text            (opsiyonel) düz metin; verilmezse HTML'den üretilir
 *   from, replyTo, cc, bcc, attachments, headers   (opsiyonel, nodemailer'a aynen iletilir)
 */
const sendEmail = async (options = {}) => {

    const to = options.to || options.email;
    const html = options.html || options.message;
    const { subject } = options;

    const recipients = [].concat(to || []);

    if (!recipients.length || !recipients.every((r) => EMAIL_RE.test(String(r).trim()))) {

        throw new Error("Geçerli bir alıcı e-posta adresi gerekli.");
    }

    if (!subject || (!html && !options.text)) {

        throw new Error("E-posta için konu ve içerik (html veya text) gerekli.");
    }

    const mailOptions = {

        from: options.from || process.env.MAIL_FROM || '"AhırBot" <' + process.env.SMTP_USER + '>',
        to: recipients,
        subject,
        html,
        text: options.text || htmlToText(html),
        replyTo: options.replyTo,
        cc: options.cc,
        bcc: options.bcc,
        attachments: options.attachments,
        headers: options.headers, // örn. bülten için List-Unsubscribe
    };

    for (let attempt = 1; ; attempt++) {

        try {

            return await getTransporter().sendMail(mailOptions);
        } catch (err) {

            if (attempt >= MAX_ATTEMPTS || !isTransient(err)) {

                // Alıcı adresi loglanmaz (kişisel veri); sadece hata kodu ve mesajı
                console.error("[sendEmail] gönderim hatası:", err.code || err.responseCode, err.message);
                throw new Error("E-posta gönderilemedi.", { cause: err });
            }

            await sleep(500 * 2 ** (attempt - 1)); // 0.5 sn, 1 sn...
        }
    }
};

// Sunucu açılışında SMTP ayarlarını test etmek için: await sendEmail.verify();
sendEmail.verify = () => getTransporter().verify();

module.exports = sendEmail;
