/**
 * Data quality scoring.
 */
import type { QualityWeights } from '../config/types.js';
import type { ColumnProfile } from '../profiler/types.js';

export class QualityScorer {
  constructor(private weights: QualityWeights) {}

  scoreColumn(profile: ColumnProfile): { score: number; grade: string; flags: string[] } {
    const flags: string[] = [];

    // --- Completeness: 1 - null_ratio ---
    const completeness = 1.0 - profile.null_ratio;

    if (profile.null_ratio >= 1.0) {
      flags.push('all_null');
    } else if (profile.null_ratio > 0.5) {
      flags.push('high_null');
    } else if (profile.null_ratio > 0.2) {
      flags.push('moderate_null');
    }

    // --- Uniqueness: distinct_ratio ---
    let uniqueness: number;
    if (profile.distinct_ratio != null && profile.distinct_ratio > 0) {
      uniqueness = Math.min(profile.distinct_ratio, 1.0);
    } else {
      uniqueness = 0.0;
    }

    if (profile.distinct_count === 1 && profile.null_ratio < 1.0) {
      flags.push('constant');
      uniqueness = 0.0;
    } else if (profile.distinct_ratio != null && profile.distinct_ratio >= 0.999) {
      flags.push('all_unique');
    } else if (profile.distinct_count < 10 && !['boolean', 'bool'].includes(profile.data_type)) {
      flags.push('low_cardinality');
    }

    // --- Consistency: pattern match ratio (string) or 1.0 (typed) ---
    let consistency = 1.0;
    if (profile.detected_patterns && Object.keys(profile.detected_patterns).length > 0) {
      const dominantRatio = Math.max(...Object.values(profile.detected_patterns));
      consistency = dominantRatio;
      if (dominantRatio < 0.5) {
        flags.push('no_dominant_pattern');
      }
    } else if (['text', 'character varying', 'varchar'].includes(profile.data_type)) {
      consistency = 0.5;
    }

    // --- Validity: non-outlier ratio (numeric) or pattern match (string) ---
    let validity = 1.0;
    if (profile.outlier_ratio != null) {
      validity = 1.0 - Math.min(profile.outlier_ratio, 1.0);
      if (profile.outlier_ratio > 0.05) {
        flags.push('high_outlier');
      } else if (profile.outlier_ratio > 0.01) {
        flags.push('moderate_outlier');
      }
    } else if (profile.detected_patterns && Object.keys(profile.detected_patterns).length > 0) {
      validity = Math.max(...Object.values(profile.detected_patterns));
    }

    // PII suspect
    if (profile.detected_patterns) {
      const piiPatterns = ['email', 'phone_tr', 'tc_kimlik'];
      for (const p of piiPatterns) {
        if ((profile.detected_patterns[p] ?? 0) > 0.5) {
          flags.push('suspected_pii');
          break;
        }
      }
    }

    // --- Composite score ---
    const w = this.weights;
    let score =
      completeness * (w.completeness ?? 0.35) +
      uniqueness * (w.uniqueness ?? 0.20) +
      consistency * (w.consistency ?? 0.25) +
      validity * (w.validity ?? 0.20);

    score = Math.round(Math.min(Math.max(score, 0.0), 1.0) * 10000) / 10000;
    const grade = QualityScorer.grade(score);

    return { score, grade, flags };
  }

  static grade(score: number): string {
    if (score >= 0.9) return 'A';
    if (score >= 0.75) return 'B';
    if (score >= 0.6) return 'C';
    if (score >= 0.4) return 'D';
    return 'F';
  }
}
