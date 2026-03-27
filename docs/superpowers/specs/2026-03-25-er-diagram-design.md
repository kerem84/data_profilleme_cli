# ER Diagram Generator — Design Spec

## Context

intellica-profiler CLI, veritabanı profilleme sonuçlarını JSON formatında üretir. Bu JSON zaten PK/FK ilişki bilgilerini (`is_primary_key`, `is_foreign_key`, `referenced_table`, `referenced_column`) içerir. Şu an bu ilişki verileri raporlarda satır bazında gösteriliyor ama görsel bir ER diyagramı üretilmiyor.

**Amaç:** Profil JSON'undan ER diyagramı oluşturan yeni bir özellik eklemek. Ana menüye ayrı bir öğe olarak entegre edilecek.

## Kararlar

| Karar | Seçim |
|-------|-------|
| Menü entegrasyonu | Ayrı menü öğesi: "ER Diyagramı Oluştur" |
| Render motoru | Graphviz (DOT formatı) — zorunlu bağımlılık |
| Graphviz yoksa | Hata ver, kurulum linki göster |
| HTML çıktısı | İnteraktif: zoom/pan/hover + arama/filtre |
| Mimari yaklaşım | Abstract ER Model (JSON → ERModel → Renderer'lar) |
| JSON seçimi | Çoklu seçim (multiselect) |
| Naming convention | snake_case (mevcut `profiler/types.ts` ile tutarlı) |

## Çıktı Formatları

| Format | Açıklama |
|--------|----------|
| SVG | Graphviz ile render, vektörel |
| PNG | Graphviz ile render, raster |
| DOT | Ham Graphviz DOT dosyası |
| Mermaid | Mermaid erDiagram syntax (.mmd) |
| HTML | İnteraktif SVG embed (zoom/pan/search/filter) |

## Detay Seviyeleri

| Seviye | Tablo Node İçeriği | Kullanım |
|--------|-------------------|----------|
| `minimal` | Sadece tablo adı (kutu) | 100+ tablolu büyük şemalar |
| `medium` | Tablo adı + PK/FK kolonları | Genel dokümantasyon |
| `full` | Tüm kolonlar, veri tipleri, constraint ikonları | Detaylı teknik referans |

## Mimari

### Dosya Yapısı

```
src/
  er-diagram/
    types.ts              # ERModel, ERTable, ERColumn, ERRelation interfaces
    er-model.ts           # JSON → ERModel dönüştürücü (detay seviyesi filtresi)
    renderers/
      dot-renderer.ts     # ERModel → DOT string
      mermaid-renderer.ts # ERModel → Mermaid erDiagram string
      html-renderer.ts    # ERModel → Interactive HTML (SVG embed + JS)
    graphviz.ts           # Graphviz CLI wrapper (dot komutu çağrısı)
    er-generator.ts       # Orchestrator: model oluştur → render → dosya yaz
templates/
  er-diagram.html.j2      # Interactive HTML template
  assets/
    er-diagram.css         # ER diagram styling
    er-diagram.js          # Pan/zoom/search/filter JS
```

### Değişecek Mevcut Dosyalar

- `src/ui/menus.ts` — Yeni menü öğesi + ER diagram akışı
- `package.json` — Yeni npm dependency yok (Graphviz harici sistem bağımlılığı)

### Veri Modeli

```typescript
type DetailLevel = 'minimal' | 'medium' | 'full';

interface ERModel {
  db_alias: string;
  schemas: ERSchema[];
  relations: ERRelation[];
  detail_level: DetailLevel;
}

interface ERSchema {
  schema_name: string;
  tables: ERTable[];
}

interface ERTable {
  schema_name: string;
  table_name: string;
  columns: ERColumn[];  // detay seviyesine göre filtrelenir
}

interface ERColumn {
  column_name: string;
  data_type: string;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  is_nullable: boolean;  // ColumnProfile.is_nullable ("YES"/"NO") → boolean dönüşümü
}

interface ERRelation {
  from_schema: string;
  from_table: string;
  from_columns: string[];   // composite FK desteği: aynı fk_constraint altındaki kolonlar
  to_schema: string;
  to_table: string;
  to_columns: string[];     // composite FK desteği
  constraint_name: string;
  cardinality: '1:1' | '1:N';  // Heuristik: FK kolonu aynı zamanda PK ise 1:1, değilse 1:N
}
```

**Cardinality heuristiği:** Profil JSON'unda cardinality bilgisi yok. Builder şu kuralı uygular:
- FK kolonu aynı zamanda PK ise → `1:1`
- Aksi halde → `1:N`
- N:M ilişkiler junction table üzerinden iki 1:N olarak doğal şekilde temsil edilir

**Composite FK:** Aynı `fk_constraint` adını paylaşan kolonlar tek bir `ERRelation`'da `from_columns[]` / `to_columns[]` olarak gruplanır.

**`is_nullable` dönüşümü:** `ColumnProfile.is_nullable` string ("YES"/"NO") → `ERColumn.is_nullable` boolean (`is_nullable === 'YES'`).

### ERModel Builder (`er-model.ts`)

`buildERModel(profile: DatabaseProfile, level: DetailLevel): ERModel`

- JSON'daki `schemas[].tables[].columns[]` üzerinden iterasyon
- `is_foreign_key === true` olan kolonlardan `ERRelation` oluşturur
  - Aynı `fk_constraint` adına sahip kolonlar gruplanır (composite FK)
  - Cardinality heuristiği uygulanır
- **Cross-schema FK:** Eğer referans edilen tablo profilde yoksa, o tablo `ERModel`'e "phantom" olarak eklenir (sadece tablo adı, kolon yok, `is_phantom: true` flag). DOT'ta kesikli çizgi (dashed border) ile gösterilir.
- **Self-referencing FK:** `from_table === to_table` durumu desteklenir. DOT'ta aynı node'a ok çizilir.
- Detay seviyesine göre kolon filtresi:
  - `minimal` → kolon yok
  - `medium` → sadece `is_primary_key || is_foreign_key`
  - `full` → tüm kolonlar

### DOT Renderer (`dot-renderer.ts`)

`renderDot(model: ERModel): string`

- `digraph ER { ... }` yapısı
- `rankdir=LR`, `splines=ortho`, `fontname="Helvetica"`
- Schema'lar `subgraph cluster_<schema>` olarak gruplanır
- `minimal`: `node [shape=box]`, sadece tablo adı
- `medium`: `shape=Mrecord`, PK (🔑) ve FK (🔗) ikonları ile
- `full`: Tüm kolonlar, PK/FK/nullable (?) ikonları, veri tipleri
- İlişki çizgileri: cardinality'ye göre `arrowhead` farklılaşır
  - `1:1` → `arrowhead=tee, arrowtail=tee`
  - `1:N` → `arrowhead=crow, arrowtail=tee`
- Phantom tablolar: `style=dashed, color=gray`
- Self-referencing FK: aynı node'a ok

### Graphviz Wrapper (`graphviz.ts`)

```typescript
async function checkGraphviz(): Promise<boolean>
async function renderWithGraphviz(dot: string, format: 'svg' | 'png', outputPath: string): Promise<void>
```

- `child_process.execFile('dot', ['-T' + format, '-o', outputPath])` ile çalıştırır
- Graphviz yoksa hata: "Graphviz kurulu değil. Kurulum: https://graphviz.org/download/"
- **Timeout:** 60 saniye (büyük grafikler için). Aşılırsa anlamlı hata.
- **stderr:** Yakalanır ve log'lanır. Render başarısız olursa DOT dosyası yine de kaydedilir.
- stdin üzerinden DOT alır, dosyaya yazar

### Mermaid Renderer (`mermaid-renderer.ts`)

`renderMermaid(model: ERModel): string`

- `erDiagram` bloğu
- Tablo tanımları: kolon adı, tip, PK/FK işaretleri
- İlişki çizgileri: cardinality'ye göre
  - `1:1` → `||--||`
  - `1:N` → `||--o{`
- `minimal` seviyede tablo entity'leri boş (kolon yok)

### HTML Renderer (`html-renderer.ts`)

`renderHtml(model: ERModel, svgContent: string): string`

- Nunjucks ile `er-diagram.html.j2` template render
- SVG inline embed
- **Implicit dependency:** HTML çıktısı her zaman SVG üretimini (→ Graphviz) gerektirir. HTML seçildiğinde SVG otomatik olarak üretilir.
- JavaScript özellikleri:
  - **Zoom/Pan:** Mouse wheel zoom + drag pan (vanilla JS)
  - **Hover:** Tablo üzerine gelince tooltip (kolon listesi, row count)
  - **Arama:** Input box → tablo adı filtresi → eşleşmeyenleri dim
  - **Schema filtresi:** Çoklu schema varsa dropdown
- Tek dosya, self-contained (CSS/JS inline)

### Orchestrator (`er-generator.ts`)

```typescript
interface ERGeneratorOptions {
  profile: DatabaseProfile;
  detail_level: DetailLevel;
  formats: ('svg' | 'png' | 'dot' | 'mermaid' | 'html')[];
  output_dir: string;
}

async function generateERDiagram(options: ERGeneratorOptions): Promise<string[]>
```

1. `buildERModel()` → ERModel
2. `renderDot()` → DOT string
3. Format seçimine göre:
   - `dot` → DOT string'i dosyaya yaz
   - `svg` → `renderWithGraphviz(dot, 'svg', path)`
   - `png` → `renderWithGraphviz(dot, 'png', path)`
   - `mermaid` → `renderMermaid(model)` → dosyaya yaz
   - `html` → SVG üret (yoksa otomatik) → `renderHtml(model, svg)` → dosyaya yaz
4. **Hata durumu:** Graphviz render başarısız olursa DOT ve Mermaid dosyaları yine de üretilir. Kullanıcıya uyarı gösterilir.
5. Üretilen dosya yollarını döndür

### Menü Akışı (`menus.ts`)

Ana menüye 5. öğe olarak (Çıkış'ın üstüne):

```
"ER Diyagramı Oluştur" →
  1. JSON dosyaları seç (output/ dizininden, multiselect)
  2. Detay seviyesi seç: minimal / medium / full
  3. Çıktı formatları seç (multiselect): SVG, PNG, HTML, Mermaid, DOT
  4. Özet ve onay
  5. Her JSON için sırayla üret (spinner ile)
  6. Tüm çıktı dosya yollarını listele
```

- JSON parse: `JSON.parse()` ile okuma, `dictToProfile()` kullanılmaz (doğrudan `DatabaseProfile` olarak cast — mevcut `reportOnlyFlow` pattern'i)
- Graphviz kontrolü: SVG/PNG/HTML seçilmişse, başlamadan önce `checkGraphviz()` çağrılır
- FK'sız profil: İlişki çizgisi olmadan sadece tablolar gösterilir, uyarı mesajı

Dosya adı pattern: `er_{db_alias}_{level}_{YYYYMMdd_HHmmss}.{ext}`

## Bilinen Kısıtlamalar

1. **Cardinality tahmini:** Gerçek cardinality yerine heuristik kullanılır (FK+PK → 1:1, diğer → 1:N)
2. **Composite FK:** Aynı constraint adı ile gruplama yapılır, farklı constraint'ler ayrı ilişki
3. **Büyük şemalar:** 200+ tablo için `minimal` seviye önerilir. Graphviz timeout 60sn.

## Verification

1. **Build:** `npm run build` hatasız tamamlanmalı
2. **Graphviz kontrolü:** Graphviz kurulu değilken anlamlı hata mesajı, DOT/Mermaid yine de üretilir
3. **Test fixture:** `output/test_baseline_mock_oracle.json` (FK verisi içerir) ile:
   - 3 detay seviyesinde DOT üretimi doğruluğu
   - SVG/PNG render başarılı
   - Mermaid syntax doğruluğu (erDiagram bloğu, ilişki çizgileri)
   - HTML interaktif özellikler (zoom, pan, search çalışıyor)
4. **Edge cases:**
   - FK'sız profil → tablo kutuları ilişkisiz, uyarı mesajı
   - Tek tablolu profil → tek node, ilişki yok
   - Cross-schema FK → phantom tablo kesikli çizgi ile
   - Self-referencing FK → aynı node'a ok
5. **Menü testi:** Ana menüden ER akışı baştan sona (multiselect JSON)
6. **Çoklu JSON:** Birden fazla JSON seçilerek toplu üretim
7. **Regresyon:** Mevcut menü öğeleri ve rapor üretimi etkilenmemiş
