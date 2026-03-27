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
  pattern_key: string | null;
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
          col.sensitivity = result;
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
