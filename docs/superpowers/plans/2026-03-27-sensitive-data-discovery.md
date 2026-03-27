# Sensitive Data Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic PII/KVKK sensitive data detection to the profiler — column name heuristics, new IBAN/credit card patterns, 3-level sensitivity scoring, masking suggestions, Excel report sheet, and standalone JSON scan mode.

**Architecture:** New `SensitivityAnalyzer` class in `src/metrics/sensitivity.ts` holds the category registry and scoring logic. It operates on `ColumnProfile` data (no DB connection needed), making it usable both inline during profiling and standalone on existing JSON. Two new patterns (IBAN, credit_card) are added to `pattern.ts` for all 4 DB engines. Results flow into Excel/HTML reports and are exposed via a new CLI subcommand + interactive menu option.

**Tech Stack:** TypeScript, ExcelJS, Nunjucks, Commander, @clack/prompts, Zod

**Spec:** `docs/superpowers/specs/2026-03-27-sensitive-data-discovery-design.md`

---

## File Structure

| File | Role | Action |
|---|---|---|
| `src/metrics/sensitivity.ts` | SensitivityAnalyzer class — category registry, heuristic matching, scoring, masking suggestions | Create |
| `src/metrics/pattern.ts` | Pattern definitions for all DB engines | Modify — add `iban` + `credit_card` to all 4 engine maps |
| `src/profiler/types.ts` | Profile data types | Modify — add `SensitivityResult` import + `sensitivity` field to `ColumnProfile` + `createDefaultColumnProfile` |
| `src/config/types.ts` | App config types | Modify — add `sensitivityThreshold` to `ProfilingConfig` |
| `src/config/schema.ts` | Zod validation schema | Modify — add `sensitivity_threshold` field |
| `src/config/loader.ts` | YAML config loader | Modify — map `sensitivity_threshold` to `sensitivityThreshold` |
| `src/profiler/profiler.ts` | Main profiling orchestrator | Modify — call `SensitivityAnalyzer.analyze()` in `profileColumn` |
| `src/metrics/quality.ts` | Quality scorer | Modify — enrich `suspected_pii` flag from sensitivity |
| `src/report/excel-report.ts` | Excel report generator | Modify — add 8th sheet "Hassas Veri Envanteri" |
| `src/report/html-report.ts` | HTML report generator | Modify — pass sensitivity data to template |
| `src/utils/profile-utils.ts` | Profile utilities | Modify — preserve `sensitivity` in `dictToProfile` |
| `src/ui/menus.ts` | Interactive menu | Modify — add "Hassas Veri Taramasi" menu option + flow |
| `src/cli.ts` | CLI entry point | Modify — add `sensitivity` subcommand |

---

### Task 1: Add IBAN and Credit Card Patterns to `pattern.ts`

**Files:**
- Modify: `src/metrics/pattern.ts`

- [ ] **Step 1: Add PG regex patterns**

In `src/metrics/pattern.ts`, these are used when `stringPatterns` config includes `iban` or `credit_card` keys. The PG patterns use `~` operator (POSIX regex). Add them as constants alongside the existing MSSQL/Oracle/HANA maps — they'll be referenced in `buildPgPatternCases()` via the user's `stringPatterns` config.

No new constant needed for PG — PG patterns come from the config `stringPatterns` record which uses raw regex. The defaults will be injected in Task 5 (config). But the DB-specific maps need entries now.

Add `iban` and `credit_card` entries to `MSSQL_PATTERN_MAP`:

```ts
// After the existing numeric_string entry:
iban: "(LEN(val) = 26 AND LEFT(val,2) = 'TR' AND PATINDEX('%[^0-9]%', SUBSTRING(val,3,24)) = 0)",
credit_card: "(LEN(REPLACE(REPLACE(val,' ',''),'-','')) BETWEEN 13 AND 19 AND PATINDEX('%[^0-9]%', REPLACE(REPLACE(val,' ',''),'-','')) = 0)",
```

- [ ] **Step 2: Add HANA patterns**

Add `iban` and `credit_card` entries to `HANA_PATTERN_MAP`:

```ts
iban: "val LIKE_REGEXPR '^TR[0-9]{24}$'",
credit_card: "(LENGTH(REPLACE(REPLACE(val,' ',''),'-','')) BETWEEN 13 AND 19 AND REPLACE(REPLACE(val,' ',''),'-','') LIKE_REGEXPR '^[0-9]+$')",
```

- [ ] **Step 3: Add Oracle patterns**

Add `iban` and `credit_card` entries to `ORACLE_PATTERN_MAP`:

```ts
iban: "REGEXP_LIKE(val, '^TR[0-9]{24}$')",
credit_card: "(LENGTH(REPLACE(REPLACE(val,' ',''),'-','')) BETWEEN 13 AND 19 AND REGEXP_LIKE(REPLACE(REPLACE(val,' ',''),'-',''), '^[0-9]+$'))",
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/pattern.ts
git commit -m "feat: add IBAN and credit card patterns for MSSQL, Oracle, HANA"
```

---

### Task 2: Create `SensitivityAnalyzer` Module

**Files:**
- Create: `src/metrics/sensitivity.ts`

- [ ] **Step 1: Create the sensitivity module**

Create `src/metrics/sensitivity.ts` with types, category registry, and analyzer class:

```ts
/**
 * Sensitive data discovery — column name heuristics + pattern-based detection.
 */
import type { ColumnProfile } from '../profiler/types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SensitivityLevel = 'none' | 'low' | 'medium' | 'high';

export type SensitivityCategory =
  | 'email'
  | 'phone_tr'
  | 'tc_kimlik'
  | 'iban'
  | 'credit_card'
  | 'person_name'
  | 'address';

export interface SensitivityResult {
  category: SensitivityCategory;
  level: SensitivityLevel;
  heuristic_match: boolean;
  pattern_match_ratio: number;
  masking_suggestion: string;
}

/* ------------------------------------------------------------------ */
/*  Category Registry                                                  */
/* ------------------------------------------------------------------ */

interface CategoryDef {
  keywords: string[];
  pattern_key: string | null; // key in detected_patterns, null = heuristic only
  masking_suggestion: string;
}

const CATEGORY_REGISTRY: Record<SensitivityCategory, CategoryDef> = {
  email: {
    keywords: ['email', 'e_posta', 'eposta', 'mail'],
    pattern_key: 'email',
    masking_suggestion: 'a***@domain.com',
  },
  phone_tr: {
    keywords: ['tel', 'telefon', 'phone', 'gsm', 'cep', 'mobile'],
    pattern_key: 'phone_tr',
    masking_suggestion: '+90 5** *** **89',
  },
  tc_kimlik: {
    keywords: ['tc', 'tckn', 'kimlik', 'identity', 'ssn'],
    pattern_key: 'tc_kimlik',
    masking_suggestion: '123********',
  },
  iban: {
    keywords: ['iban'],
    pattern_key: 'iban',
    masking_suggestion: 'TR** **** ... son 4',
  },
  credit_card: {
    keywords: ['kredi_kart', 'credit_card', 'kart_no', 'card'],
    pattern_key: 'credit_card',
    masking_suggestion: '**** **** **** 1234',
  },
  person_name: {
    keywords: ['isim', 'ad', 'soyad', 'name', 'first_name', 'last_name', 'adi', 'soyadi'],
    pattern_key: null,
    masking_suggestion: 'M***',
  },
  address: {
    keywords: ['adres', 'address', 'sokak', 'cadde', 'street'],
    pattern_key: null,
    masking_suggestion: '*** Sok. No:**',
  },
};

/* ------------------------------------------------------------------ */
/*  Sensitivity level ordering (for threshold filtering)               */
/* ------------------------------------------------------------------ */

const LEVEL_ORDER: Record<SensitivityLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function meetsThreshold(level: SensitivityLevel, threshold: SensitivityLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold];
}

/* ------------------------------------------------------------------ */
/*  Analyzer                                                           */
/* ------------------------------------------------------------------ */

export class SensitivityAnalyzer {
  /**
   * Analyze a column profile for sensitive data.
   * Returns the highest-severity match, or null if no sensitivity detected.
   */
  static analyze(col: ColumnProfile): SensitivityResult | null {
    let best: SensitivityResult | null = null;

    const colNameLower = col.column_name.toLowerCase();
    const patterns = col.detected_patterns ?? {};

    for (const [cat, def] of Object.entries(CATEGORY_REGISTRY) as [SensitivityCategory, CategoryDef][]) {
      const heuristic = def.keywords.some((kw) => colNameLower.includes(kw));
      const patternRatio = def.pattern_key ? (patterns[def.pattern_key] ?? 0) : 0;
      const hasPattern = patternRatio > 0;

      let level: SensitivityLevel;
      if (heuristic && hasPattern) {
        level = 'high';
      } else if (hasPattern) {
        level = 'medium';
      } else if (heuristic) {
        level = 'low';
      } else {
        continue;
      }

      // Keep the highest severity match
      if (!best || LEVEL_ORDER[level] > LEVEL_ORDER[best.level]) {
        best = {
          category: cat,
          level,
          heuristic_match: heuristic,
          pattern_match_ratio: patternRatio,
          masking_suggestion: def.masking_suggestion,
        };
      }
    }

    return best;
  }

  /**
   * Analyze all columns in a DatabaseProfile (for standalone JSON scan).
   * Returns columns with sensitivity >= threshold.
   */
  static scanProfile(
    profile: { schemas: { schema_name: string; tables: { table_name: string; columns: ColumnProfile[] }[] }[] },
    threshold: SensitivityLevel = 'low',
  ): { schema: string; table: string; column: string; dataType: string; result: SensitivityResult }[] {
    const findings: { schema: string; table: string; column: string; dataType: string; result: SensitivityResult }[] = [];

    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          const result = SensitivityAnalyzer.analyze(col);
          if (result && meetsThreshold(result.level, threshold)) {
            findings.push({
              schema: schema.schema_name,
              table: table.table_name,
              column: col.column_name,
              dataType: col.data_type,
              result,
            });
          }
        }
      }
    }

    return findings;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/metrics/sensitivity.ts
git commit -m "feat: add SensitivityAnalyzer module with category registry and scoring"
```

---

### Task 3: Update Type Definitions and Config

**Files:**
- Modify: `src/profiler/types.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/utils/profile-utils.ts`

- [ ] **Step 1: Add `sensitivity` field to `ColumnProfile` in `types.ts`**

In `src/profiler/types.ts`, add the import at the top:

```ts
import type { SensitivityResult } from '../metrics/sensitivity.js';
```

Add field to the `ColumnProfile` interface after line 63 (`quality_flags: string[];`):

```ts
  // Sensitivity
  sensitivity: SensitivityResult | null;
```

Add default value in `createDefaultColumnProfile` function, after `dwh_targets: [],` (line 175):

```ts
    sensitivity: null,
```

- [ ] **Step 2: Add `sensitivityThreshold` to `ProfilingConfig` in `config/types.ts`**

In `src/config/types.ts`, add the import at the top:

```ts
import type { SensitivityLevel } from '../metrics/sensitivity.js';
```

Add field to `ProfilingConfig` interface after `stringPatterns` (line 41):

```ts
  sensitivityThreshold: SensitivityLevel;
```

- [ ] **Step 3: Update Zod schema in `config/schema.ts`**

In `src/config/schema.ts`, add to `profilingConfigSchema` object after `string_patterns` (line 40):

```ts
  sensitivity_threshold: z.enum(['none', 'low', 'medium', 'high']).default('low'),
```

- [ ] **Step 4: Update config loader in `config/loader.ts`**

In `src/config/loader.ts`, add to the `profiling` object in the return statement (after `stringPatterns` line 74):

```ts
      sensitivityThreshold: data.profiling.sensitivity_threshold,
```

- [ ] **Step 5: Update `dictToProfile` in `profile-utils.ts`**

In `src/utils/profile-utils.ts`, update the column mapping inside `dictToProfile` to preserve sensitivity data. In the columns map callback (around line 18-22), add after `dwh_targets: c.dwh_targets ?? [],`:

```ts
        sensitivity: c.sensitivity ?? null,
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/profiler/types.ts src/config/types.ts src/config/schema.ts src/config/loader.ts src/utils/profile-utils.ts
git commit -m "feat: add sensitivity types, config field, and profile deserialization"
```

---

### Task 4: Integrate Sensitivity into Profiler and Quality Scorer

**Files:**
- Modify: `src/profiler/profiler.ts`
- Modify: `src/metrics/quality.ts`

- [ ] **Step 1: Add sensitivity analysis call in `profiler.ts`**

In `src/profiler/profiler.ts`, add import at the top (after existing metric imports):

```ts
import { SensitivityAnalyzer } from '../metrics/sensitivity.js';
```

In the `profileColumn` method, add after the quality scoring block (after line 509 `colProf.quality_flags = flags;`):

```ts
    // Sensitivity analysis
    colProf.sensitivity = SensitivityAnalyzer.analyze(colProf);
```

- [ ] **Step 2: Enrich `suspected_pii` flag in `quality.ts`**

In `src/metrics/quality.ts`, add import at the top:

```ts
import type { SensitivityResult } from './sensitivity.js';
```

Replace the existing PII suspect block (lines 67-75) with an enriched version:

```ts
    // PII suspect — from pattern analysis
    if (profile.detected_patterns) {
      const piiPatterns = ['email', 'phone_tr', 'tc_kimlik'];
      for (const p of piiPatterns) {
        if ((profile.detected_patterns[p] ?? 0) > 0.5) {
          flags.push('suspected_pii');
          break;
        }
      }
    }

    // PII suspect — from sensitivity analysis (high level)
    if (!flags.includes('suspected_pii') && profile.sensitivity?.level === 'high') {
      flags.push('suspected_pii');
    }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/profiler/profiler.ts src/metrics/quality.ts
git commit -m "feat: integrate sensitivity analysis into profiler and quality scorer"
```

---

### Task 5: Add Default IBAN/Credit Card to Config String Patterns

**Files:**
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Update default `string_patterns` in Zod schema**

Currently `string_patterns` defaults to `{}`. Update it to include the new patterns so they run automatically during profiling (PG regex format — the DB-specific maps in pattern.ts handle MSSQL/Oracle/HANA):

In `src/config/schema.ts`, change line 40:

```ts
  string_patterns: z.record(z.string()).default({}),
```

to:

```ts
  string_patterns: z.record(z.string()).default({
    email: '.+@.+\\..+',
    phone_tr: '^(\\+90|0)[0-9]{10}$',
    tc_kimlik: '^[1-9][0-9]{10}$',
    iban: '^TR[0-9]{24}$',
    credit_card: '^[0-9]{13,19}$',
  }),
```

> **Note:** Previously `string_patterns` defaulted to empty, meaning no patterns ran unless the user added them to config. This change makes the standard patterns (including the new IBAN/credit_card) run by default. Users can still override in their YAML config. If the user previously had an empty `string_patterns: {}` in their config, that explicit empty will still win over the default — this only affects configs that omit the key entirely.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat: add default string patterns including IBAN and credit card"
```

---

### Task 6: Add "Hassas Veri Envanteri" Sheet to Excel Report

**Files:**
- Modify: `src/report/excel-report.ts`

- [ ] **Step 1: Import sensitivity types**

In `src/report/excel-report.ts`, add import at the top:

```ts
import type { SensitivityLevel } from '../metrics/sensitivity.js';
import { meetsThreshold } from '../metrics/sensitivity.js';
```

- [ ] **Step 2: Add sensitivity level color fills**

Add after the existing `GRADE_FILLS` constant (around line 23):

```ts
const SENSITIVITY_FILLS: Record<string, ExcelJS.Fill> = {
  high: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } },
  medium: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
  low: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
};
```

- [ ] **Step 3: Add `sensitivityThreshold` to constructor**

Update the constructor to accept the threshold:

```ts
constructor(
  private mappingEnabled: boolean = false,
  private sensitivityThreshold: SensitivityLevel = 'low',
) {}
```

- [ ] **Step 4: Call the new sheet writer in `generate`**

In the `generate` method, add after `this.writeOutlierReport(wb, profile);` (line 44):

```ts
    this.writeSensitivityInventory(wb, profile);
```

- [ ] **Step 5: Implement `writeSensitivityInventory` method**

Add this method at the end of the class (before the closing `}`):

```ts
  private writeSensitivityInventory(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Hassas Veri Envanteri');
    const headers = [
      'Sema', 'Tablo', 'Kolon', 'Veri Tipi',
      'Kategori', 'Seviye', 'Heuristic Eslesmesi', 'Pattern Orani',
      'Maskeleme Onerisi',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          if (!col.sensitivity || col.sensitivity.level === 'none') continue;
          if (!meetsThreshold(col.sensitivity.level, this.sensitivityThreshold)) continue;

          const s = col.sensitivity;
          ws.getRow(r).getCell(1).value = schema.schema_name;
          ws.getRow(r).getCell(2).value = table.table_name;
          ws.getRow(r).getCell(3).value = col.column_name;
          ws.getRow(r).getCell(4).value = col.data_type;
          ws.getRow(r).getCell(5).value = s.category;
          const levelCell = ws.getRow(r).getCell(6);
          levelCell.value = s.level;
          levelCell.fill = SENSITIVITY_FILLS[s.level] ?? {};
          ws.getRow(r).getCell(7).value = s.heuristic_match ? 'Evet' : 'Hayir';
          ws.getRow(r).getCell(8).value = s.pattern_match_ratio > 0
            ? Math.round(s.pattern_match_ratio * 10000) / 10000
            : '';
          ws.getRow(r).getCell(9).value = s.masking_suggestion;

          for (let c = 1; c <= 9; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
          r++;
        }
      }
    }
    this.autoWidth(ws);
  }
```

- [ ] **Step 6: Update ExcelReportGenerator call sites**

In `src/utils/profile-utils.ts`, update the `generateReports` function where `ExcelReportGenerator` is instantiated (line 92):

Change:
```ts
    const gen = new ExcelReportGenerator(config.mapping.enabled);
```
To:
```ts
    const gen = new ExcelReportGenerator(config.mapping.enabled, config.profiling.sensitivityThreshold);
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/report/excel-report.ts src/utils/profile-utils.ts
git commit -m "feat: add Hassas Veri Envanteri sheet to Excel report"
```

---

### Task 7: Add Sensitivity Badge to HTML Report

**Files:**
- Modify: `src/report/html-report.ts`

- [ ] **Step 1: Add `sensitivity_label` filter to Nunjucks environment**

In the `HtmlReportGenerator` constructor, after the existing filter registrations (after line 28, `dateshort` filter):

```ts
    this.env.addFilter('sensitivity_label', (val: unknown) => {
      const s = val as { level?: string; category?: string } | null;
      if (!s || s.level === 'none') return '';
      const labels: Record<string, string> = { high: 'YUKSEK', medium: 'ORTA', low: 'DUSUK' };
      return `${labels[s.level!] ?? s.level} — ${s.category}`;
    });
```

This filter is now available in the Nunjucks template as `{{ col.sensitivity | sensitivity_label }}`. The template (`templates/report.html.j2`) can use it to render a badge wherever column details are shown. The actual template edit depends on the template structure — add a `<span class="badge badge-sensitivity">` where column info is displayed, conditionally rendered when the filter returns non-empty.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/report/html-report.ts
git commit -m "feat: add sensitivity label filter for HTML report"
```

---

### Task 8: Add `sensitivity` CLI Subcommand

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the sensitivity subcommand**

In `src/cli.ts`, add imports at the top:

```ts
import { SensitivityAnalyzer, meetsThreshold } from './metrics/sensitivity.js';
import type { SensitivityLevel } from './metrics/sensitivity.js';
import { ExcelReportGenerator } from './report/excel-report.js';
```

Add the subcommand after the `diff` command block (before `program.parse()`):

```ts
// Sensitivity scan subcommand
program
  .command('sensitivity')
  .description('Profil JSON dosyasinda hassas veri taramasi yap (PII/KVKK)')
  .argument('<json_path>', 'Profil JSON dosya yolu')
  .option('-o, --output <dir>', 'Cikti dizini', './output')
  .option('-t, --threshold <level>', 'Minimum sensitivity seviyesi (none|low|medium|high)', 'low')
  .action(async (jsonPath: string, opts) => {
    if (!fs.existsSync(jsonPath)) {
      console.error(`Dosya bulunamadi: ${jsonPath}`);
      process.exit(1);
    }

    const threshold = opts.threshold as SensitivityLevel;
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const profile = dictToProfile(data);

    console.log(`Profil: ${profile.db_alias} — ${profile.profiled_at}`);
    console.log(`Threshold: ${threshold}\n`);

    const findings = SensitivityAnalyzer.scanProfile(profile, threshold);

    if (findings.length === 0) {
      console.log('Hassas veri bulunamadi.');
      return;
    }

    // Console summary
    console.log(`${findings.length} hassas kolon tespit edildi:\n`);
    const levelCounts = { high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const lvl = f.result.level as keyof typeof levelCounts;
      if (lvl in levelCounts) levelCounts[lvl]++;
      console.log(`  [${f.result.level.toUpperCase()}] ${f.schema}.${f.table}.${f.column} — ${f.result.category} (maskeleme: ${f.result.masking_suggestion})`);
    }
    console.log(`\nOzet: ${levelCounts.high} yuksek, ${levelCounts.medium} orta, ${levelCounts.low} dusuk`);

    // Excel output
    fs.mkdirSync(opts.output, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');
    const excelPath = path.join(opts.output, `sensitivity_${profile.db_alias}_${timestamp}.xlsx`);

    // Generate Excel with only the sensitivity sheet populated
    const gen = new ExcelReportGenerator(false, threshold);
    await gen.generate(profile, excelPath);
    console.log(`\nExcel: ${excelPath}`);
  });
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add sensitivity CLI subcommand for standalone JSON scanning"
```

---

### Task 9: Add "Hassas Veri Taramasi" to Interactive Menu

**Files:**
- Modify: `src/ui/menus.ts`

- [ ] **Step 1: Add imports**

In `src/ui/menus.ts`, add imports at the top:

```ts
import { SensitivityAnalyzer } from '../metrics/sensitivity.js';
import type { SensitivityLevel } from '../metrics/sensitivity.js';
import { ExcelReportGenerator } from '../report/excel-report.js';
```

- [ ] **Step 2: Add menu option**

In the `showMainMenu` function, add the sensitivity option between `report` and `diff` in the options array:

```ts
        { value: 'sensitivity', label: 'Hassas Veri Taramasi', hint: "Profil JSON'dan PII/KVKK tespiti" },
```

Add the case in the switch statement (after the `report` case):

```ts
      case 'sensitivity':
        await sensitivityFlow(config);
        break;
```

- [ ] **Step 3: Implement `sensitivityFlow` function**

Add the flow function (after `reportOnlyFlow` or any convenient location):

```ts
/* ------------------------------------------------------------------ */
/*  Sensitivity scan flow                                              */
/* ------------------------------------------------------------------ */

async function sensitivityFlow(config: AppConfig): Promise<void> {
  // Find JSON files in output dir
  const outDir = path.resolve(config.outputDir);
  let jsonFiles: string[] = [];
  if (fs.existsSync(outDir)) {
    jsonFiles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith('profil_') && f.endsWith('.json'))
      .sort()
      .reverse();
  }

  let jsonPath: string;

  if (jsonFiles.length > 0) {
    await resetStdin();
    const chosen = await p.select({
      message: 'Taranacak profil JSON dosyasini secin:',
      options: jsonFiles.slice(0, 10).map((f) => ({
        value: path.join(outDir, f),
        label: f.replace('profil_', '').replace('.json', ''),
      })),
    });
    if (p.isCancel(chosen)) return;
    jsonPath = chosen as string;
  } else {
    p.log.warn(`${outDir} dizininde profil JSON bulunamadi.`);
    await resetStdin();
    const manual = await promptJsonPath();
    if (p.isCancel(manual) || !manual) return;
    jsonPath = manual as string;
  }

  const s = p.spinner();
  s.start('Hassas veri taramasi yapiliyor...');

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const profile = dictToProfile(data);
    const threshold = config.profiling.sensitivityThreshold;
    const findings = SensitivityAnalyzer.scanProfile(profile, threshold);

    s.stop(`${SYM.ok} Tarama tamamlandi`);

    if (findings.length === 0) {
      p.log.info('Hassas veri bulunamadi.');
      return;
    }

    // Summary by level
    const levelCounts = { high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const lvl = f.result.level as keyof typeof levelCounts;
      if (lvl in levelCounts) levelCounts[lvl]++;
    }

    p.note(
      [
        `${findings.length} hassas kolon tespit edildi`,
        `  Yuksek: ${levelCounts.high}`,
        `  Orta:   ${levelCounts.medium}`,
        `  Dusuk:  ${levelCounts.low}`,
      ].join('\n'),
      'Hassas Veri Ozeti',
    );

    // Show top findings
    const topFindings = findings.slice(0, 20);
    for (const f of topFindings) {
      const levelColor = f.result.level === 'high' ? C.fail : f.result.level === 'medium' ? C.warn : C.dim;
      p.log.info(
        `${levelColor(`[${f.result.level.toUpperCase()}]`)} ${f.schema}.${f.table}.${C.bold(f.column)} — ${f.result.category}`,
      );
    }
    if (findings.length > 20) {
      p.log.info(C.dim(`... ve ${findings.length - 20} daha`));
    }

    // Ask to generate Excel
    await resetStdin();
    const genExcel = await p.confirm({
      message: 'Hassas veri envanteri Excel dosyasi olusturulsun mu?',
      initialValue: true,
    });
    if (p.isCancel(genExcel) || !genExcel) return;

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');
    const excelPath = path.join(config.outputDir, `sensitivity_${profile.db_alias}_${timestamp}.xlsx`);
    fs.mkdirSync(config.outputDir, { recursive: true });

    const gen = new ExcelReportGenerator(false, threshold);
    await gen.generate(profile, excelPath);

    p.log.success(`Excel: ${excelPath}`);
  } catch (e) {
    s.stop(`${SYM.fail} Tarama hatasi: ${e}`);
  }
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/menus.ts
git commit -m "feat: add Hassas Veri Taramasi to interactive menu"
```

---

### Task 10: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `npx tsc -p tsconfig.build.json`
Expected: Clean build, `dist/` populated.

- [ ] **Step 2: Test CLI help**

Run: `node dist/cli.js --help`
Expected: Shows `sensitivity` subcommand in the list.

Run: `node dist/cli.js sensitivity --help`
Expected: Shows `<json_path>` argument and `-o`, `-t` options.

- [ ] **Step 3: Test with existing JSON (if available)**

If there's a profil JSON in `./output/`:

```bash
node dist/cli.js sensitivity ./output/profil_*.json -t low
```

Expected: Prints findings summary or "Hassas veri bulunamadi."

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve build issues from sensitivity integration"
```
