# Sensitive Data Discovery (PII/KVKK Tespiti) - Design Spec

**Issue:** #8
**Tarih:** 2026-03-27
**Durum:** Onaylandi

---

## 1. Ozet

Mevcut pattern analizi altyapisini genisleterek otomatik hassas veri tespiti. KVKK/GDPR uyumlulugu icin kolon ismi heuristic + veri pattern eslesme + sensitivity seviyelendirme + maskeleme onerisi.

## 2. Yeni Modul: `src/metrics/sensitivity.ts`

### Veri Modeli

```ts
type SensitivityLevel = 'none' | 'low' | 'medium' | 'high';

type SensitivityCategory =
  | 'email'
  | 'phone_tr'
  | 'tc_kimlik'
  | 'iban'
  | 'credit_card'
  | 'person_name'
  | 'address';

interface SensitivityResult {
  category: SensitivityCategory;
  level: SensitivityLevel;
  heuristic_match: boolean;
  pattern_match_ratio: number;
  masking_suggestion: string;
}
```

### Kategori Registry (Hardcoded)

| Kategori | Heuristic Keywords (TR+EN) | Pattern Kaynagi | Maskeleme Onerisi |
|---|---|---|---|
| email | email, e_posta, eposta, mail | mevcut `email` pattern | `a***@domain.com` |
| phone_tr | tel, telefon, phone, gsm, cep, mobile | mevcut `phone_tr` pattern | `+90 5** *** **89` |
| tc_kimlik | tc, tckn, kimlik, identity, ssn | mevcut `tc_kimlik` pattern | `123********` |
| iban | iban | **yeni** `TR\d{2}\d{4}\d{16}` | `TR** **** ... son 4` |
| credit_card | kredi_kart, credit_card, kart_no, card | **yeni** format + prefix | `**** **** **** 1234` |
| person_name | isim, ad, soyad, name, first_name, last_name, adi, soyadi | yok (sadece heuristic) | `M***` |
| address | adres, address, sokak, cadde, street | yok (sadece heuristic) | `*** Sok. No:**` |

### Hesaplama Mantigi

- Kolon ismi keyword'lerden biriyle eslesiyor (case-insensitive, substring match: `toLowerCase().includes(keyword)`) → `heuristic_match = true`
- Pattern sonucu (mevcut `detected_patterns`'dan) > 0 → `pattern_match_ratio` atanir
- Seviye belirleme:
  - Sadece heuristic eslesmesi → `low`
  - Sadece pattern eslesmesi → `medium`
  - Ikisi birden → `high`
  - Hicbiri → `none`

## 3. Pattern Eklentileri: IBAN ve Kredi Karti

### IBAN Pattern

Tum DB engine'lere eklenir:

- **PG:** `^TR\d{24}$`
- **MSSQL:** `LEN(val) = 26 AND LEFT(val,2) = 'TR' AND PATINDEX('%[^0-9]%', SUBSTRING(val,3,24)) = 0`
- **Oracle:** `REGEXP_LIKE(val, '^TR[0-9]{24}$')`
- **HANA:** `val LIKE_REGEXPR '^TR[0-9]{24}$'`

### Kredi Karti Pattern

SQL'de Luhn yapilmaz, sadece format kontrolu (normalize edilmis: bosluk/tire temizlenmis):

- 13-19 digit, sadece rakam
- `REPLACE(REPLACE(val,' ',''),'-','')` ile normalize
- **PG:** `^[0-9]{13,19}$` (normalize edilmis val uzerinde)
- **MSSQL:** `LEN(...) BETWEEN 13 AND 19 AND PATINDEX('%[^0-9]%', ...) = 0`
- **Oracle:** `LENGTH(...) BETWEEN 13 AND 19 AND REGEXP_LIKE(..., '^[0-9]+$')`
- **HANA:** `LENGTH(...) BETWEEN 13 AND 19 AND ... LIKE_REGEXPR '^[0-9]+$'`

## 4. Entegrasyon Noktalari

### ColumnProfile (`types.ts`)

Yeni alan eklenir (quality alanlarindan sonra):

```ts
sensitivity: SensitivityResult | null;
```

### Profiler (`profiler.ts`)

`profileColumn` sonunda, quality scoring'den sonra:

```ts
const sensitivity = SensitivityAnalyzer.analyze(colProf);
colProf.sensitivity = sensitivity;
```

### Config (`types.ts` + `schema.ts`)

`ProfilingConfig`'e eklenir:

```ts
sensitivityThreshold: SensitivityLevel; // default: 'low'
```

Zod schema'da:

```ts
sensitivity_threshold: z.enum(['none', 'low', 'medium', 'high']).default('low')
```

### Excel Rapor (`excel-report.ts`)

8. sheet: **"Hassas Veri Envanteri"** — sadece `sensitivity.level !== 'none'` olan kolonlar.

Kolonlar:
- Sema, Tablo, Kolon, Veri Tipi
- Kategori, Seviye, Heuristic Eslesmesi, Pattern Orani
- Maskeleme Onerisi

Seviye renklendirmesi:
- `high` → kirmizi (`FFF4CCCC`)
- `medium` → turuncu (`FFFCE4D6`)
- `low` → sari (`FFFFF2CC`)

### HTML Rapor (`html-report.ts`)

Kolon detaylarinda sensitivity bilgisi varsa badge olarak gosterilir (minimal eklenti).

### Quality Scorer (`quality.ts`)

Mevcut `suspected_pii` flag mantigi korunur. Ek olarak: sensitivity level `high` ise `suspected_pii` flag otomatik eklenir.

## 5. CLI & Menu Entegrasyonu

### Interaktif Menu (`menus.ts`)

Ana menuye yeni secenek (profile ile er arasina):

```ts
{ value: 'sensitivity', label: 'Hassas Veri Taramasi', hint: "Profil JSON'dan PII/KVKK tespiti" }
```

Akis:
1. Kullanicidan profil JSON dosyasi secimi
2. `SensitivityAnalyzer` ile analiz
3. Console'da ozet + Excel ciktisi (sadece Hassas Veri Envanteri sheet'i)

### CLI Subcommand (`cli.ts`)

Non-interactive kullanim:

```
intellica-profiler sensitivity <profil.json> -o ./output
```

### Uc Calisma Modu

| Mod | Tetikleyici | Veri Kaynagi |
|---|---|---|
| Inline | Normal profilleme akisi | DB'den canli profil |
| Standalone (menu) | Ana menu → "Hassas Veri Taramasi" | Mevcut JSON |
| Standalone (CLI) | `sensitivity <json>` komutu | Mevcut JSON |

Her uc modda ayni `SensitivityAnalyzer` calisir. Inline modda IBAN/credit_card pattern'leri de mevcuttur, standalone'da JSON'da yoksa sadece heuristic calisir.

## 6. Dosya Degisiklikleri Ozeti

| Dosya | Degisiklik |
|---|---|
| `src/metrics/sensitivity.ts` | **Yeni** — SensitivityAnalyzer sinifi |
| `src/metrics/pattern.ts` | IBAN + credit_card pattern eklentisi (4 DB engine) |
| `src/profiler/types.ts` | `ColumnProfile`'a `sensitivity` alani |
| `src/profiler/profiler.ts` | `profileColumn`'da sensitivity analizi cagrisi |
| `src/config/types.ts` | `sensitivityThreshold` alani |
| `src/config/schema.ts` | Zod schema guncelleme |
| `src/report/excel-report.ts` | "Hassas Veri Envanteri" sheet |
| `src/report/html-report.ts` | Sensitivity badge |
| `src/metrics/quality.ts` | `suspected_pii` flag zenginlestirme |
| `src/ui/menus.ts` | Yeni menu secenegi + sensitivity flow |
| `src/cli.ts` | `sensitivity` subcommand |
