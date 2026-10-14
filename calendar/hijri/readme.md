# Kalendar Tarikh Penting Islam Malaysia

Projek ini bertujuan untuk memaparkan tarikh-tarikh penting dalam kalendar Islam bagi Malaysia dalam format jadual yang kemas, moden, dan responsif. Ia direka untuk dimuatkan dengan pantas dan sangat mudah untuk dikemas kini setiap tahun.

---

### Pautan Berkaitan

*   **Laman Kalendar Utama:** [dev.mamtj6.com/calendar/hijri/tarikh-penting/](https://dev.mamtj6.com/calendar/hijri/tarikh-penting/)
*   **Integrasi Penuh (bersama Widget):** [www.mamtj6.com/takwim/takwim-islam](https://www.mamtj6.com/takwim/takwim-islam)
*   **Contoh Widget Kira Detik:** [dev.mamtj6.com/calendar/hijri/widgets/widgets.html](https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html)
*   **Info Waktu dan Tarikh Hijri Terkini:** [dev.mamtj6.com/calendar/hijri/hari-ini/](https://dev.mamtj6.com/calendar/hijri/hari-ini/)

---

### Ciri-ciri Utama

*   **Reka Bentuk Moden (shadcn/ui):** Menggunakan Tailwind CSS dengan reka bentuk terinspirasi shadcn/ui, fon Inter, dan palet warna Zinc/Emerald/Amber.
*   **Mod Terang & Gelap:** Menyokong tema terang dan gelap dengan pengesanan automatik keutamaan sistem dan penyimpanan pilihan pengguna.
*   **Paparan Tarikh Tepat:** Memaparkan tarikh Masihi dan Hijrah berdasarkan takwim rasmi dalam format `Hijri / Masihi (Hari)`.
*   **Kira Detik (Countdown):** Mengira baki hari ke setiap acara akan datang.
*   **Susun Atur Responsif:** Desktop menggunakan susun atur dua lajur (kad peristiwa terdekat sticky di kiri, jadual di kanan). Pada skrin kecil, jadual bertukar kepada paparan kad yang mesra pengguna.
*   **Pusat Data Tunggal:** Semua data acara dan tarikh kemas kini diuruskan melalui satu fail sahaja, iaitu `data/events.json`.
*   **Widget Boleh Benam:** Disertakan dengan fail `widgets/widgets.html` dan `widgets/widgets2.html` berasingan untuk menjana kad kira detik yang boleh dibenamkan di mana-mana laman web lain.
*   **Widget Hari Ini:** `hari-ini/index.html` memaparkan jam rasmi Waktu Standard Malaysia (MST) dari SIRIM dan tarikh Hijrah semasa yang disegerakkan dengan data e-Solat JAKIM.

---

### Teknologi yang Digunakan

*   **HTML5**
*   **Tailwind CSS** (melalui Play CDN, dengan konfigurasi `darkMode: 'class'`)
*   **Google Fonts** (Inter — fon shadcn/ui)
*   **CSS3** (gaya khas untuk paparan kad mobile dalam `tarikh-penting/style.css`)
*   **JavaScript ES6+** (Vanilla JS dalam `tarikh-penting/app.js` — tanpa sebarang *framework*)
*   **JSON** (untuk penyimpanan data acara)
*   **API e-Solat JAKIM** (penukaran tarikh Hijri masa nyata)
*   **Vercel** (untuk pengehosan pantas)

---

### Struktur Fail

```
calendar/hijri/
  data/
    events.json             ← Data acara (sumber tunggal untuk semua halaman)
  tarikh-penting/
    index.html              ← Halaman kalendar utama (HTML + Tailwind CDN)
    app.js                  ← Logik JavaScript (tema, API, rendering jadual)
    style.css               ← Gaya khas mobile (table-to-card)
    info2.html              ← Variasi susun atur alternatif (inline CSS/JS)
  widgets/
    widgets.html            ← Widget kira detik v1 (untuk iframe)
    widgets2.html           ← Widget kira detik v2 (responsif lebih baik)
  hari-ini/
    index.html              ← Widget waktu MST & tarikh Hijri semasa
  CLAUDE.md
  readme.md
```

---

### Cara Mengemas Kini Tarikh (Untuk Rujukan Tahunan)

Mengemas kini data untuk tahun baharu adalah sangat mudah dan hanya melibatkan satu fail.

1.  **Buka Fail `data/events.json`:** Navigasi ke fail `data/events.json` di dalam repositori ini.
2.  **Kemas Kini Senarai Acara:** Di bawah kunci `"events"`, ubah suai senarai acara dengan maklumat `eventName`, `eventDate` (dalam format `YYYY-MM-DD`), dan `hijriDate` yang baharu.
3.  **Kemas Kini Tarikh:** Di bahagian atas fail, kemas kini nilai `lastUpdated` kepada tarikh dan masa anda membuat perubahan.
4.  **Simpan Fail:** Simpan (commit) perubahan tersebut. Laman web akan dikemas kini secara automatik dalam beberapa minit.

---

### Widget Countdown Boleh Benam

Projek ini juga menyertakan fail `widgets/widgets.html` dan `widgets/widgets2.html` yang boleh digunakan untuk memaparkan kira detik bagi satu acara secara khusus. Widget ini boleh dibenamkan di mana-mana laman web menggunakan `<iframe>`.

#### Cara Penggunaan

Gunakan kod `<iframe>` di bawah dan ubah suai `src` untuk menunjuk ke lokasi `widgets.html` anda. Pemilihan acara dikawal menggunakan parameter URL `?event=`.

```html
<iframe src="https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=NAMA_ACARA" style="width:250px; height:350px; border:none;"></iframe>
```

Gantikan `NAMA_ACARA` dengan kata kunci unik dari `eventName` dalam fail `data/events.json`.

#### Senarai Pautan Widget Sedia Guna

Berikut adalah senarai pautan penuh untuk setiap acara yang boleh anda gunakan terus.

| Peristiwa | Pautan Widget Penuh |
| :--- | :--- |
| Israk dan Mikraj | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Israk` |
| Nisfu Sya'ban | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Nisfu` |
| Awal Ramadan | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Ramadan` |
| Hari Nuzul Al-Quran | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Nuzul` |
| Hari Raya Aidilfitri | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Aidilfitri` |
| Hari Arafah | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Arafah` |
| Hari Raya Aidiladha | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Aidiladha` |
| Awal Muharram | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Muharram` |
| Hari Asyura | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Asyura` |
| Maulidur Rasul | `https://dev.mamtj6.com/calendar/hijri/widgets/widgets.html?event=Maulidur` |

---

### Sumber Rujukan & Penghargaan

*   Semua data tarikh Masihi dan Hijrah dirujuk dari portal **e-Solat oleh JAKIM**: [www.e-solat.gov.my](https://www.e-solat.gov.my/index.php?siteId=24&pageId=52)
*   Projek ini dibangunkan dan diselenggara oleh **Admin MAMTJ6**.
*   Untuk sebarang pertanyaan, sila hubungi melalui WhatsApp: [wa.me/601156828198](https://wa.me/601156828198)
