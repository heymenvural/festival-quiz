# Festival Quiz

Meydanda 500 kişinin telefonundan katıldığı, dev ekrandan yönetilen canlı quiz. Veritabanı yok, her şey RAM'de; Socket.io ile anlık.

## Çalıştırma

```bash
npm install
npm start
```

- Oyuncu ekranı: `http://localhost:3000`
- Dev ekran: `http://localhost:3000/host` (şifre: `festival`)

Şifreyi değiştirmek için: `HOST_KEY=gizlisifre npm start`

## Nasıl yönetilir

Dev ekranda **boşluk tuşu** = devam. Akış şöyle:

| Basış | Ne olur |
|---|---|
| Lobide | Soru 1 başlar, telefonlarda butonlar açılır |
| Soru sırasında | Süreyi keser, sonucu gösterir |
| Sonuç ekranında | Sonraki soruya geçer |
| Son sorudan sonra | Şampiyon podyumu |

**R tuşu** = yarışmayı sıfırla (puanları siler, `questions.json`'ı yeniden okur — sunucuyu durdurmadan soru değiştirebilirsin).

## Puanlama

Doğru cevap `500 + 500 × (kalan süre oranı)` puan. Yani ilk saniyede basan ~1000, son saniyede basan 500 alır. Yanlış cevap 0 puan ve seriyi sıfırlar.

Üst üste doğru yapana seri bonusu: 2. doğruda +50, 3.'te +100 … 6. ve sonrasında +250 sabit.

## Soru ekleme

`questions.json` içine ekle, `correct` 0'dan başlar (0=A, 1=B, 2=C, 3=D). `sure` yazmazsan 20 saniye olur.

```json
{
  "question": "Buharkent hangi ilimizin ilçesidir?",
  "options": ["Denizli", "Aydın", "Muğla", "Manisa"],
  "correct": 1,
  "sure": 15
}
```

## Ayarlar (`server.js` içinde `AYAR` bloğu)

| Ayar | Ne işe yarar |
|---|---|
| `ANLIK_GERI_BILDIRIM` | `true`: oyuncu basar basmaz telefonunda doğru/yanlış görür. `false`: herkes cevaplayana kadar bekler — yandaki arkadaşının ekranından kopya çekilmesini engeller. Kalabalıkta `false` daha adil. |
| `TABAN_PUAN` / `MAX_PUAN` | Hız farkının puana etkisi. İkisi eşit olursa hız önemsizleşir. |
| `SERI_BONUSU` | Seri bonusunu kapatır. |
| `VARSAYILAN_SURE` | `sure` yazılmamış sorular için saniye. |

## Ücretsiz yayına alma

**En sağlamı: kendi bilgisayarın + Cloudflare Tunnel.** Ücretsiz katman sunucularının CPU'su kısıtlı, 15 dakika hareketsizlikte uykuya geçiyor — sahnede uyanmasını beklemek istemezsin. Laptop'ın o sunuculardan güçlü:

```bash
# cloudflared kur (bir kez), sonra:
npm start                                   # 1. terminal
cloudflared tunnel --url http://localhost:3000   # 2. terminal
```

İkinci terminal sana `https://xxx.trycloudflare.com` verir. Hesap gerekmez, ücretsiz, HTTPS'li. Host ekranını o adresten aç — QR otomatik o adrese basılır.

**Alternatif: Render.com** (ücretsiz katman, WebSocket destekli). GitHub'a yükle → New Web Service → Build: `npm install`, Start: `npm start`, Environment: `HOST_KEY`. Uykuya geçmemesi için etkinlikten 20 dk önce açıp `/saglik` adresine bir istek at.

## Festival günü kontrol listesi

- Etkinlikten önce **kendi telefonunla mobil veriden** (WiFi kapalı) linki test et.
- Karekodun yanına adresi büyük puntoyla da yaz — karekod okutamayan hep olur.
- Kalabalıkta baz istasyonu tıkanır, sinyal geç gelebilir. Süreleri 10 saniyenin altına indirme.
- Oyuncular geç katılabilir; soru ortasında bağlananlar kalan süreyle soruyu görür.
- Telefonu kilitlenip geri dönen oyuncu puanını kaybetmez (tarayıcı hafızasındaki kimlikle devam eder). Gizli sekmede açanlar yeni oyuncu sayılır.
- Dev ekran sekmesini yarışma sırasında yenileme; yenilersen lobi görünür, bir sonraki geçişte kendine gelir.

## Dosyalar

```
server.js            oyun motoru: durum, süre, puan, sıralama
questions.json       sorular
public/index.html    telefon ekranı
public/host.html     dev ekran
```
