WITH quartiles AS (
    SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CAST({column_name} AS NUMBER)) AS q1,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CAST({column_name} AS NUMBER)) AS q3
    FROM {schema_name}.{table_name}
    WHERE {column_name} IS NOT NULL
),
bounds AS (
    SELECT
        q1, q3,
        q3 - q1 AS iqr,
        q1 - :iqr_multiplier * (q3 - q1) AS lower_bound,
        q3 + :iqr_multiplier * (q3 - q1) AS upper_bound
    FROM quartiles
)
SELECT
    b.q1, b.q3, b.iqr, b.lower_bound, b.upper_bound,
    COUNT(CASE WHEN CAST(t.{column_name} AS NUMBER) < b.lower_bound
                 OR CAST(t.{column_name} AS NUMBER) > b.upper_bound
               THEN 1 END) AS outlier_count,
    COUNT(t.{column_name}) AS total_non_null
FROM {schema_name}.{table_name} t
CROSS JOIN bounds b
WHERE t.{column_name} IS NOT NULL
GROUP BY b.q1, b.q3, b.iqr, b.lower_bound, b.upper_bound
