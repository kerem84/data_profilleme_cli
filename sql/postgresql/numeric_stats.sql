-- Numerik istatistikler: ortalama, stddev, percentile
-- Identifier params: {schema_name}, {table_name}, {column_name}
SELECT
    AVG({column_name}::numeric) AS mean_value,
    STDDEV({column_name}::numeric) AS stddev_value,
    PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p01,
    PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p05,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p75,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY {column_name}::numeric) AS p99
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL;
