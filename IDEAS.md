# Feature Ideas — @intellica/data-profiler

## 1. Incremental Profiling (Delta Analiz)

Sadece degisen tablolari yeniden profille. Onceki profil JSON'u ile karsilastirip row count veya checksum farki olan tablolari tespit et. Buyuk veritabanlarinda tam profilleme saatler surebilir — delta modu bunu dakikalara indirir.

- Onceki JSON'dan tablo hash/row count karsilastirmasi
- `--incremental` veya `--since <json_path>` flag
- Degismeyen tablolarda onceki profili tasi

## 2. Profil Karsilastirma (Diff Report)

Iki profil JSON'u arasindaki farklari gosteren rapor. Zaman icinde veri kalitesinin nasil degistigini takip etmek icin.

- Kolon bazinda: null ratio, distinct ratio, quality score degisimleri
- Yeni/silinen tablo/kolon tespiti
- Excel'de renkli diff sheet (yesil=iyilesen, kirmizi=kotulesen)
- HTML'de trend grafikleri

## 3. Scheduler / Cron Entegrasyonu

Profillemeyi periyodik olarak calistirip trend verisi toplama.

- `intellica-profiler schedule --cron "0 3 * * 1" -c config.yaml`
- Sonuclari bir dizinde tarih bazli sakla
- Opsiyonel: kalite skoru esik altina dusunce alert (Slack, email, webhook)

## 4. Referential Integrity Check (FK Tutarliligi)

FK iliskilerindeki yetim kayitlari tespit et. Profillemenin otesinde aktif veri kalitesi kontrolu.

- FK → PK eslesmesi sorgusu
- Yetim kayit sayisi ve ornekleri
- Rapora "Referential Integrity" sheet/section ekle

## 5. Cross-Database Profil Karsilastirma

Farkli veritabanlarindaki ayni tablolari karsilastir. Migrasyon veya ETL dogrulamasi icin.

- Kaynak vs hedef tablo eslestirme (config'den veya otomatik isim eslestirme)
- Row count, null ratio, distinct ratio farklari
- Eksik/fazla kayit tespiti (sampling ile)

## 6. Data Lineage Gorunumu

Mapping dosyasindan yola cikarak kaynak → hedef veri akisini gorsel olarak goster.

- HTML raporda interaktif lineage diagram (D3.js veya Mermaid)
- Tablo/kolon bazinda kaynak-hedef eslesmesi
- Kalite skoru ile renklendirme (dusuk kaliteli kaynaklar kirmizi)

## 7. Custom Rule Engine

Kullanici tanimli veri kalitesi kurallari.

```yaml
rules:
  - name: "TC Kimlik Not Null"
    table: "musteri"
    column: "tc_kimlik"
    check: "null_ratio < 0.01"
    severity: "error"
  - name: "Email Format"
    table: "musteri"
    column: "email"
    check: "pattern_match.email > 0.95"
    severity: "warning"
```

- Config'e `rules` section ekle
- Profilleme sonrasi kurallari degerlendir
- Rapora "Rule Violations" sheet/section ekle
- CI/CD entegrasyonu icin exit code (kural ihlali varsa non-zero)

## 8. Sampling Stratejileri

Mevcut rastgele sampling'e ek olarak akilli ornekleme.

- **Stratified sampling**: Kategorik kolona gore oransal ornekleme
- **Time-based sampling**: Son N gundeki kayitlari profille (tarih kolonu belirtilerek)
- **Top/bottom sampling**: Outlier analizi icin uclardaki kayitlara odaklan

## 9. PDF Rapor Ciktisi

Excel ve HTML'e ek olarak PDF formatinda rapor. Yonetim sunumlari icin.

- Puppeteer veya pdfkit ile HTML → PDF donusumu
- Kapak sayfasi, icerik tablosu, sayfa numaralari
- Ozet dashboard + detay sayfalari

## 10. Interactive HTML Dashboard

Mevcut statik HTML'i interaktif single-page dashboard'a donustur.

- Filtreleme: schema, tablo, kalite grade'i
- Siralama: herhangi bir kolona gore
- Arama: tablo/kolon ismi
- Drill-down: ozet → schema → tablo → kolon detay
- Dark mode toggle

## 11. Column Relationship Detection

PK/FK disindaki iliskileri otomatik tespit et.

- Ayni isimdeki kolonlar arasi korelasyon
- Value overlap analizi (iki kolonun kesisim orani)
- Potansiyel join adaylari onerisi
- Mapping dosyasi icin otomatik oneri

## 12. Data Catalog Export

Profil sonuclarini standart formatlarda disari aktar.

- **OpenMetadata** JSON format
- **Apache Atlas** entities
- **dbt** sources YAML
- **Great Expectations** suite
- Mevcut sistemlerle entegrasyon kolayligi

## 13. Parallel Profiling

Birden fazla tablo/schema'yi paralel profille.

- Worker thread veya Promise.all ile paralel sorgu
- Connection pool limitine uygun concurrency (config'den)
- Ilerleme gostergesinde paralel tablo isimleri
- Buyuk veritabanlarinda 3-5x hizlanma

## 14. Sensitive Data Discovery (PII/GDPR)

Mevcut pattern analizini genisleterek otomatik hassas veri tespiti.

- KVKK / GDPR kategorileri (ad-soyad, adres, telefon, TC, IBAN, kredi karti)
- Kolon ismi + veri icerigi bazli skorlama
- Rapora "Sensitive Data Inventory" section
- Maskeleme/anonimizasyon onerisi

## 15. REST API Mode

CLI'a ek olarak HTTP API olarak calisabilme.

- `intellica-profiler serve --port 8080`
- `POST /profile` — profilleme baslat
- `GET /profiles` — mevcut profilleri listele
- `GET /profiles/:id/report` — rapor indir
- WebSocket ile canli ilerleme
- Frontend dashboard icin backend

## Onceliklendirme Onerisi

| Oncelik | Feature | Etki | Efor |
|---------|---------|------|------|
| P0 | Incremental Profiling | Yuksek | Orta |
| P0 | Parallel Profiling | Yuksek | Orta |
| P1 | Profil Karsilastirma | Yuksek | Dusuk |
| P1 | Custom Rule Engine | Yuksek | Orta |
| P1 | Sensitive Data Discovery | Yuksek | Dusuk |
| P2 | Interactive Dashboard | Orta | Orta |
| P2 | Referential Integrity | Orta | Dusuk |
| P2 | PDF Rapor | Dusuk | Dusuk |
| P3 | REST API Mode | Orta | Yuksek |
| P3 | Data Catalog Export | Orta | Orta |
| P3 | Scheduler | Dusuk | Orta |
| P3 | Cross-DB Karsilastirma | Orta | Yuksek |
| P3 | Column Relationship | Dusuk | Yuksek |
| P3 | Data Lineage | Dusuk | Yuksek |
| P3 | Sampling Stratejileri | Dusuk | Orta |
