# @intellica/data-profiler

Kaynak veritabani tablolarini otomatik profilleme araci. PostgreSQL ve MSSQL veritabanlarina baglanarak tablo ve kolon bazinda kalite analizi yapar, Excel ve HTML raporlari uretir.

## Ozellikler

- **Coklu DB Destegi**: PostgreSQL ve MSSQL
- **Interaktif CLI**: Menu tabanli veritabani/sema/tablo secimi
- **Kolon Profilleme**: NULL orani, distinct sayisi, min/max, top-N degerler
- **Numerik Analiz**: Ortalama, standart sapma, percentile, histogram, outlier tespiti (IQR)
- **Pattern Tespiti**: Email, telefon, TC kimlik, UUID, tarih vb. regex desenleri
- **Kalite Skorlama**: Completeness, uniqueness, consistency, validity boyutlarinda A-F not sistemi
- **Tablo Boyutu**: Her tablo icin disk boyutu (bytes, KB, MB, GB)
- **Raporlama**: Excel (.xlsx) ve HTML (Chart.js grafikleri dahil)
- **Guvenli**: Read-only session (PG), WITH NOLOCK (MSSQL), statement timeout, connection pool limiti

## Kurulum

```bash
npm install -g @intellica/data-profiler
```

**Gereksinimler**: Node.js >= 18

## Hizli Baslangic

### 1. Config Dosyasi Olustur

Ornek config'i kopyala ve duzenle:

```bash
cp $(npm root -g)/@intellica/data-profiler/config/config.example.yaml config.yaml
```

```yaml
project:
  name: "Proje Adi"
  output_dir: "./output"

databases:
  my_pg:
    db_type: "postgresql"
    host: "localhost"
    port: 5432
    dbname: "mydb"
    user: "user"
    password: "pass"
    connect_timeout: 15
    statement_timeout: 300000
    schema_filter: "*"            # "*" = tum semalar, veya ["public", "sales"]

  my_mssql:
    db_type: "mssql"
    host: "192.168.1.100"
    port: 1433
    dbname: "ERP"
    user: "sa"
    password: "pass"
    connect_timeout: 15
    statement_timeout: 300000
    schema_filter: "*"

profiling:
  top_n_values: 20
  sample_threshold: 5000000
  sample_percent: 10
  outlier_iqr_multiplier: 1.5
  quality_weights:
    completeness: 0.35
    uniqueness: 0.20
    consistency: 0.25
    validity: 0.20

reporting:
  excel:
    enabled: true
    filename_template: "profil_{db_alias}_{timestamp}.xlsx"
  html:
    enabled: true
    filename_template: "profil_{db_alias}_{timestamp}.html"
    embed_assets: true

logging:
  level: "INFO"
  file: "./output/profil.log"
```

### 2. Calistir

```bash
intellica-profiler -c config.yaml
```

### 3. Interaktif Menu

CLI calistiginda asagidaki menuyu gorursunuz:

```
Ne yapmak istiyorsunuz?
  > Veritabani Profille
    JSON'dan Rapor Uret
    Baglanti Testi
    Cikis
```

**Profilleme akisi:**
1. Veritabani sec (Tumunu Sec / Manuel Sec)
2. Baglanti testi otomatik calisir
3. Semalar kesfedilir
4. Sema sec (Tumunu Sec / Manuel Sec)
5. Rapor secenekleri (Excel, HTML)
6. Ozet onay
7. Profilleme baslar, ilerleme cubugu gosterilir
8. JSON + Excel + HTML raporlari `output_dir`'e yazilir

## Cikti Dosyalari

```
output/
  profil_mydb_20260308_120000.json    # Ham profil verisi
  profil_mydb_20260308_120000.xlsx    # Excel raporu
  profil_mydb_20260308_120000.html    # HTML raporu (grafikli)
  profil.log                          # Islem logu
```

## Kalite Skorlama

Her kolon 4 boyutta degerlendirilir:

| Boyut | Agirlik | Aciklama |
|---|---|---|
| Completeness | %35 | NULL orani |
| Uniqueness | %20 | Distinct orani |
| Consistency | %25 | Pattern tutarliligi |
| Validity | %20 | Veri tipi uygunlugu |

**Not Sistemi**: A (>=90), B (>=75), C (>=60), D (>=40), F (<40), N/A (bos tablo)

## Docker ile Test

`mock_db/` dizininde test icin PostgreSQL ve MSSQL container'lari mevcuttur:

```bash
cd mock_db
docker compose up -d postgres mssql
```

Seed data yukle:
```bash
docker exec mock_postgres psql -U testuser -d mockdb -c "SELECT 1"
docker exec mock_mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Test1234!" -C -Q "SELECT 1"
```

Mock config ile calistir:
```bash
intellica-profiler -c config/config.mock.yaml
```

## Programatik Kullanim

```typescript
import { loadConfig } from '@intellica/data-profiler';
import { createConnector } from '@intellica/data-profiler';
import { Profiler } from '@intellica/data-profiler';

const config = loadConfig('config.yaml');
const connector = createConnector(config.databases.my_pg);
const profiler = new Profiler(config, 'my_pg', connector, './sql');
const profile = await profiler.profileDatabase();

console.log(profile.total_tables, profile.total_size_display);
```

## Lisans

MIT
