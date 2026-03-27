# @intellica/data-profiler
<img width="946" height="662" alt="image" src="https://github.com/user-attachments/assets/df9d77ff-c8da-4158-8be1-f8200f5b722f" />




Kaynak veritabani tablolarini otomatik profilleme araci. PostgreSQL, MSSQL, Oracle ve SAP BW/HANA veritabanlarina baglanarak tablo ve kolon bazinda kalite analizi yapar, Excel ve HTML raporlari uretir, ER diyagramlari olusturur.

## Ozellikler

### Profilleme
- **Coklu DB Destegi**: PostgreSQL, MSSQL, Oracle ve SAP BW/HANA
- **Interaktif CLI**: Menu tabanli veritabani/sema/tablo secimi (Tumunu Sec / Manuel Sec)
- **Paralel Profilleme**: Tablolar es zamanli profillenir (3-5x hizlanma)
- **Incremental Profilleme**: Sadece degisen tablolari yeniden profille (delta analiz)
- **Kolon Profilleme**: NULL orani, distinct sayisi, min/max, top-N degerler
- **Numerik Analiz**: Ortalama, standart sapma, percentile, histogram, outlier tespiti (IQR)
- **Pattern Tespiti**: Email, telefon, TC kimlik, UUID, tarih vb. regex desenleri
- **Kalite Skorlama**: Completeness, uniqueness, consistency, validity boyutlarinda A-F not sistemi
- **Tablo Boyutu**: Her tablo icin disk boyutu (bytes, KB, MB, GB)
- **PK/FK Tespiti**: Primary key ve foreign key iliskileri metadata'dan cikarilir
- **Raporlama**: Excel (.xlsx) ve HTML (Chart.js grafikleri dahil)
- **Profil Karsilastirma**: Iki profil JSON arasindaki farklari raporla (diff report)
- **Guvenli**: Read-only session (PG), WITH NOLOCK (MSSQL), SET TRANSACTION READ ONLY (Oracle), statement timeout, connection pool limiti

### ER Diyagrami
- **Otomatik Uretim**: Profil JSON'dan PK/FK iliskilerine dayali ER diyagrami
- **Cikti Formatlari**: SVG, PNG, HTML (interaktif), Mermaid (.mmd), DOT
- **Detay Seviyeleri**: Minimal (sadece tablo adlari), Medium (PK/FK kolonlari), Full (tum kolonlar)
- **Sema Bazli SVG**: Her sema icin ayri Graphviz layout'lu SVG uretimi
- **Interaktif HTML**: Zoom/pan, tablo arama, sema dropdown ile SVG degistirme, tooltip
- **Engine Secimi**: dot, neato, fdp, sfdp, circo, twopi veya otomatik
- **Phantom Tablolar**: Cross-schema FK hedefleri kesikli cerceveli ghost node olarak gosterilir
- **Crow's Foot Notasyonu**: 1:1 ve 1:N iliskileri gorsel kardinalite sembolleriyle

## Kurulum

```bash
npm install -g @intellica/data-profiler
```

**Gereksinimler**: Node.js >= 18

> Oracle baglantisi icin Oracle Client kurulumu **gerekmez** — `oracledb` thin mode ile calisir.

> ER diyagrami (SVG/PNG/HTML) icin [Graphviz](https://graphviz.org/download/) gereklidir:
> ```bash
> # Windows
> winget install Graphviz
> # macOS
> brew install graphviz
> # Ubuntu/Debian
> sudo apt install graphviz
> ```
> Mermaid ve DOT formatlari Graphviz olmadan da calisir.

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
  # PostgreSQL
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

  # MSSQL
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

  # Oracle
  my_oracle:
    db_type: "oracle"
    host: "192.168.1.200"
    port: 1521
    dbname: "ORCL"              # SID (service_name yoksa kullanilir)
    service_name: "ORCLPDB"     # Service name (tercih edilir)
    user: "user"
    password: "pass"
    connect_timeout: 15
    statement_timeout: 300000
    schema_filter: "*"          # Oracle'da owner = schema

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
    Profil Karsilastir
    ER Diyagrami Olustur
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

**ER diyagrami akisi:**
1. Profil JSON dosyasi sec
2. Detay seviyesi sec (minimal / medium / full)
3. Cikti formatlari sec (SVG, PNG, HTML, Mermaid, DOT)
4. Graphviz engine sec (otomatik / dot / sfdp / ...)
5. Sema sec (Tumunu Sec / tek sema)
6. Sema basina ayri SVG + birlesik HTML uretilir

## Cikti Dosyalari

```
output/
  profil_mydb_20260308_120000.json    # Ham profil verisi
  profil_mydb_20260308_120000.xlsx    # Excel raporu
  profil_mydb_20260308_120000.html    # HTML raporu (grafikli)
  profil.log                          # Islem logu

  er_mydb/                            # ER diyagramlari (database bazli)
    er_mydb_medium_20260325.svg       # Birlesik SVG (tum semalar)
    er_mydb_medium_20260325.html      # Interaktif HTML (tum SVG'ler embed)
    public/                           # Sema bazli klasor
      er_mydb_public_medium_....svg   # Sadece public semasi + phantom komsular
    sales/
      er_mydb_sales_medium_....svg
```

## Desteklenen Veritabanlari

| Ozellik | PostgreSQL | MSSQL | Oracle | SAP BW/HANA |
|---|---|---|---|---|
| Baglanti | `pg` (Pool) | `mssql` (tedious) | `oracledb` (thin) | `hdb` (hana-client) |
| Read-only | `SET SESSION READ ONLY` | `READ_UNCOMMITTED` + `NOLOCK` | `SET TRANSACTION READ ONLY` | Read-only connection |
| Schema discovery | `information_schema` | `sys.schemas` | `ALL_TABLES` (owner) | `SYS.TABLES` |
| PK/FK | `pg_constraint` | `sys.foreign_keys` | `ALL_CONSTRAINTS` | `SYS.CONSTRAINTS` |
| Tablo boyutu | `pg_total_relation_size()` | `sys.allocation_units` | `DBA_SEGMENTS` / `USER_SEGMENTS` | `M_TABLE_PERSISTENCE_STATISTICS` |
| Percentile | `PERCENTILE_CONT` | `PERCENTILE_CONT OVER()` | `PERCENTILE_CONT WITHIN GROUP` | `PERCENTILE_CONT` |
| Pattern | regex `~` | `PATINDEX` / `LIKE` | `REGEXP_LIKE` | `LIKE` |
| Row limit | `LIMIT` | `TOP(n)` | `FETCH FIRST n ROWS ONLY` | `LIMIT` |
| Identifier quoting | `"name"` | `[name]` | `"name"` | `"name"` |

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

`mock_db/` dizininde test icin PostgreSQL, MSSQL ve Oracle container'lari mevcuttur:

```bash
cd mock_db
docker compose up -d
```

> Oracle XE ilk acilista 2-3 dakika surebilir.

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
const connector = createConnector(config.databases.my_oracle);
const profiler = new Profiler(config, 'my_oracle', connector, './sql');
const profile = await profiler.profileDatabase();

console.log(profile.total_tables, profile.total_size_display);
```

## Lisans

MIT
