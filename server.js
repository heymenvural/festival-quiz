const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 20000,
    pingTimeout: 25000,
    cors: { origin: '*' }
});

/* ------------------------------------------------------------------
   AYARLAR
------------------------------------------------------------------ */
const AYAR = {
    // Host ekranına giriş şifresi. Sabit: buharkent09
    HOST_SIFRE: process.env.HOST_KEY || 'buharkent09',

    VARSAYILAN_SURE: 20,      // questions.json'da "sure" yazmayan sorular için saniye
    TABAN_PUAN: 500,          // doğru cevabın garanti puanı
    MAX_PUAN: 1000,           // en hızlı cevabın puanı
    SERI_BONUSU: true,        // üst üste doğru yapana ekstra puan
    SERI_BONUS_PUAN: 50,      // her seri kademesi için (max 5 kademe = 250)

    // true  -> oyuncu butona basar basmaz telefonunda doğru/yanlış görür (senin istediğin)
    // false -> herkes cevaplayıp süre bitince görür (yandaki arkadaşından kopya çekilmez)
    ANLIK_GERI_BILDIRIM: true,

    SONUC_BEKLEME_MS: 1200    // herkes cevaplayınca sonuca geçmeden önceki nefes payı
};

/* ------------------------------------------------------------------
   SORULAR
------------------------------------------------------------------ */
let sorular = [];
function sorulariYukle() {
    const ham = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
    sorular = ham.map((s, i) => {
        if (!Array.isArray(s.options) || s.options.length !== 4) {
            throw new Error(`${i + 1}. soruda tam 4 şık olmalı.`);
        }
        if (typeof s.correct !== 'number' || s.correct < 0 || s.correct > 3) {
            throw new Error(`${i + 1}. soruda "correct" 0-3 arasında olmalı.`);
        }
        return { ...s, sure: s.sure || AYAR.VARSAYILAN_SURE };
    });
    console.log(`📋 ${sorular.length} soru yüklendi.`);
}
sorulariYukle();

/* ------------------------------------------------------------------
   OYUN DURUMU (hepsi RAM'de)
------------------------------------------------------------------ */
const oyuncular = new Map();   // pid -> { pid, ad, puan, seri, socketId, kopmaZamani }
const hostlar = new Set();     // yetkili host socket id'leri

const oyun = {
    durum: 'lobi',   // lobi | soru | sonuc | bitti
    index: -1,
    baslangic: 0,
    sure: 0,
    zamanlayici: null,
    cevaplar: new Map()  // pid -> { sik, dogru, puan }
};

const rastgeleAd = () => `Festivalci #${Math.floor(1000 + Math.random() * 9000)}`;

function bagliSayisi() {
    let n = 0;
    for (const o of oyuncular.values()) if (o.socketId) n++;
    return n;
}

function siralama() {
    return [...oyuncular.values()].sort((a, b) => b.puan - a.puan || a.ad.localeCompare(b.ad));
}

// Sayaç bilgileri sadece host ekranını ilgilendirir. 500 kişide herkese yayın
// yapmak gereksiz trafik demek; bu yüzden host'a özel ve kısıtlı gönderiyoruz.
let sonSayacYayini = 0, sayacBekleyen = null;

function hostaGonder(olay, veri) {
    for (const id of hostlar) io.to(id).emit(olay, veri);
}

function tabloGonder() {
    const simdi = Date.now();
    if (simdi - sonSayacYayini < 250) {
        if (!sayacBekleyen) sayacBekleyen = setTimeout(() => { sayacBekleyen = null; tabloGonder(); }, 250);
        return;
    }
    sonSayacYayini = simdi;
    hostaGonder('oyuncuSayisi', bagliSayisi());
    if (oyun.durum === 'soru') {
        hostaGonder('cevapSayisi', { cevaplayan: oyun.cevaplar.size, toplam: bagliSayisi() });
    }
}

/* ------------------------------------------------------------------
   OYUN AKIŞI
------------------------------------------------------------------ */
function soruBaslat() {
    clearTimeout(oyun.zamanlayici);
    oyun.index++;

    if (oyun.index >= sorular.length) return oyunuBitir();

    const s = sorular[oyun.index];
    oyun.durum = 'soru';
    oyun.sure = s.sure;
    oyun.cevaplar = new Map();
    oyun.baslangic = Date.now();

    io.emit('soru', {
        no: oyun.index + 1,
        toplam: sorular.length,
        metin: s.question,
        siklar: s.options,
        sure: s.sure
    });

    // Süre dolunca otomatik kapat (+ ağ gecikmesi payı)
    oyun.zamanlayici = setTimeout(soruBitir, s.sure * 1000 + 500);
}

function soruBitir() {
    if (oyun.durum !== 'soru') return;
    clearTimeout(oyun.zamanlayici);
    oyun.durum = 'sonuc';

    const s = sorular[oyun.index];
    const dagilim = [0, 0, 0, 0];
    for (const c of oyun.cevaplar.values()) dagilim[c.sik]++;

    const sirali = siralama();
    const sira = new Map(sirali.map((o, i) => [o.pid, i + 1]));

    // Dev ekran: doğru şık + cevap dağılımı + ilk 10
    io.emit('soruBitti', {
        dogruSik: s.correct,
        dogruMetin: s.options[s.correct],
        siklar: s.options,
        dagilim,
        cevaplayan: oyun.cevaplar.size,
        toplamOyuncu: bagliSayisi(),
        ilk10: sirali.slice(0, 10).map(o => ({ ad: o.ad, puan: o.puan })),
        sonSoru: oyun.index === sorular.length - 1
    });

    // Her telefona kendi kişisel sonucu
    for (const o of oyuncular.values()) {
        if (!o.socketId) continue;
        const c = oyun.cevaplar.get(o.pid);
        io.to(o.socketId).emit('kisiselSonuc', {
            cevapladi: !!c,
            dogru: c ? c.dogru : false,
            kazanilan: c ? c.puan : 0,
            toplamPuan: o.puan,
            seri: o.seri,
            sira: sira.get(o.pid),
            kisiSayisi: sirali.length,
            dogruSik: s.correct,
            dogruMetin: s.options[s.correct]
        });
    }
}

function oyunuBitir() {
    clearTimeout(oyun.zamanlayici);
    oyun.durum = 'bitti';
    const sirali = siralama();
    const sira = new Map(sirali.map((o, i) => [o.pid, i + 1]));

    io.emit('oyunBitti', sirali.slice(0, 10).map(o => ({ ad: o.ad, puan: o.puan })));

    for (const o of oyuncular.values()) {
        if (!o.socketId) continue;
        io.to(o.socketId).emit('finalSiran', {
            sira: sira.get(o.pid),
            kisiSayisi: sirali.length,
            toplamPuan: o.puan
        });
    }
}

function oyunuSifirla() {
    clearTimeout(oyun.zamanlayici);
    oyun.durum = 'lobi';
    oyun.index = -1;
    oyun.cevaplar = new Map();
    for (const o of oyuncular.values()) { o.puan = 0; o.seri = 0; }
    sorulariYukle();
    io.emit('sifirla');
    tabloGonder();
}

/* ------------------------------------------------------------------
   BAĞLANTILAR
------------------------------------------------------------------ */
io.on('connection', (socket) => {

    /* ---- Oyuncu katılımı (pid ile kaldığı yerden devam eder) ---- */
    socket.on('katil', (pid) => {
        let oyuncu = pid && oyuncular.get(pid);

        if (oyuncu) {
            oyuncu.socketId = socket.id;
            oyuncu.kopmaZamani = null;
        } else {
            const yeniPid = socket.id + '-' + Date.now().toString(36);
            oyuncu = { pid: yeniPid, ad: rastgeleAd(), puan: 0, seri: 0, socketId: socket.id, kopmaZamani: null };
            oyuncular.set(yeniPid, oyuncu);
        }

        socket.data.pid = oyuncu.pid;
        console.log(`[+] ${oyuncu.ad} bağlandı. (toplam ${bagliSayisi()})`);

        socket.emit('hosgeldin', {
            pid: oyuncu.pid,
            ad: oyuncu.ad,
            puan: oyuncu.puan,
            durum: oyun.durum,
            cevapVerdiMi: oyun.cevaplar.has(oyuncu.pid)
        });

        // Oyun sürerken katılan/geri dönen kişiye mevcut soruyu kalan süresiyle gönder
        if (oyun.durum === 'soru') {
            const s = sorular[oyun.index];
            const kalan = Math.max(1, Math.round((oyun.baslangic + oyun.sure * 1000 - Date.now()) / 1000));
            socket.emit('soru', {
                no: oyun.index + 1, toplam: sorular.length,
                metin: s.question, siklar: s.options, sure: kalan
            });
        }

        tabloGonder();
    });

    /* ---- Cevap ---- */
    socket.on('cevap', (sik) => {
        if (oyun.durum !== 'soru') return;
        const pid = socket.data.pid;
        const oyuncu = oyuncular.get(pid);
        if (!oyuncu) return;
        if (oyun.cevaplar.has(pid)) return;                 // çift cevap yok
        if (!Number.isInteger(sik) || sik < 0 || sik > 3) return;

        const s = sorular[oyun.index];
        const gecen = (Date.now() - oyun.baslangic) / 1000;
        if (gecen > oyun.sure + 1) return;                  // geç gelen cevap

        const dogru = sik === s.correct;
        let puan = 0;

        if (dogru) {
            const oran = Math.max(0, 1 - gecen / oyun.sure);
            puan = Math.round(AYAR.TABAN_PUAN + (AYAR.MAX_PUAN - AYAR.TABAN_PUAN) * oran);
            oyuncu.seri++;
            if (AYAR.SERI_BONUSU && oyuncu.seri > 1) {
                puan += Math.min(oyuncu.seri - 1, 5) * AYAR.SERI_BONUS_PUAN;
            }
            oyuncu.puan += puan;
        } else {
            oyuncu.seri = 0;
        }

        oyun.cevaplar.set(pid, { sik, dogru, puan });

        socket.emit('cevapAlindi', AYAR.ANLIK_GERI_BILDIRIM
            ? { anlik: true, dogru, kazanilan: puan, toplamPuan: oyuncu.puan, seri: oyuncu.seri }
            : { anlik: false });

        tabloGonder();

        // Herkes cevapladıysa süreyi beklemeden sonuca geç
        if (oyun.cevaplar.size >= bagliSayisi()) {
            clearTimeout(oyun.zamanlayici);
            oyun.zamanlayici = setTimeout(soruBitir, AYAR.SONUC_BEKLEME_MS);
        }
    });

    /* ---- Host ---- */
    socket.on('hostGiris', (sifre) => {
        if (sifre !== AYAR.HOST_SIFRE) return socket.emit('hostRed');
        hostlar.add(socket.id);
        socket.emit('hostOnay', {
            durum: oyun.durum,
            oyuncu: bagliSayisi(),
            soruSayisi: sorular.length,
            index: oyun.index
        });
    });

    const hostMu = () => hostlar.has(socket.id);

    socket.on('hostDevam', () => {
        if (!hostMu()) return;
        if (oyun.durum === 'soru') return soruBitir();      // süreyi kesip sonucu göster
        if (oyun.durum === 'bitti') return;
        soruBaslat();
    });

    socket.on('hostSifirla', () => { if (hostMu()) oyunuSifirla(); });

    /* ---- Kopma ---- */
    socket.on('disconnect', () => {
        hostlar.delete(socket.id);
        const oyuncu = oyuncular.get(socket.data.pid);
        if (oyuncu) {
            oyuncu.socketId = null;
            oyuncu.kopmaZamani = Date.now();
        }
        tabloGonder();
    });
});

// Hiç puan almadan kopup 3 dakikadır dönmeyenleri temizle (liste şişmesin)
setInterval(() => {
    const simdi = Date.now();
    for (const [pid, o] of oyuncular) {
        if (!o.socketId && o.puan === 0 && simdi - (o.kopmaZamani || 0) > 180000) {
            oyuncular.delete(pid);
        }
    }
}, 60000);

/* ------------------------------------------------------------------
   SUNUCU
------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/host', (_, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
// Karekod sunucuda üretilir: dış CDN'e bağımlı değil, adresi isteğin kendisinden alır
app.get('/qr.svg', async (req, res) => {
    try {
        const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
        const adres = `${proto}://${req.headers.host}/`;
        const svg = await QRCode.toString(adres, {
            type: 'svg', margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#0B0A1F', light: '#FFFFFF' }
        });
        res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
    } catch (e) {
        res.status(500).send('qr uretilemedi');
    }
});

app.get('/saglik', (_, res) => res.json({ ok: true, oyuncu: bagliSayisi(), durum: oyun.durum }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu ayakta: http://localhost:${PORT}`);
    console.log(`🎛️  Host ekranı:  http://localhost:${PORT}/host   (şifre: ${AYAR.HOST_SIFRE})`);
});
