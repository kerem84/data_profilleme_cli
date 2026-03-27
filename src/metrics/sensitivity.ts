/**
 * Sensitivity analysis – stub (to be fully implemented by Task 2).
 */

export type SensitivityLevel = 'none' | 'low' | 'medium' | 'high';

export interface SensitivityResult {
  level: SensitivityLevel;
  matched_rules: string[];
  score: number;
}

export function meetsThreshold(result: SensitivityResult, threshold: SensitivityLevel): boolean {
  const order: SensitivityLevel[] = ['none', 'low', 'medium', 'high'];
  return order.indexOf(result.level) >= order.indexOf(threshold);
}

export class SensitivityAnalyzer {
  constructor(private threshold: SensitivityLevel = 'low') {}

  analyze(_columnName: string, _samples: unknown[]): SensitivityResult {
    return { level: 'none', matched_rules: [], score: 0 };
  }
}
