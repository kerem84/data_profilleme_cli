SELECT
    AVG(CAST({column_name} AS DOUBLE))                                                     AS mean_value,
    STDDEV(CAST({column_name} AS DOUBLE))                                                  AS stddev_value,
    PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p01,
    PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p05,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p75,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CAST({column_name} AS DOUBLE))            AS p99
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL
