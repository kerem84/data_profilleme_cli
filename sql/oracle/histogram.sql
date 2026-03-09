WITH stats AS (
    SELECT
        MIN(CAST({column_name} AS NUMBER)) AS min_val,
        MAX(CAST({column_name} AS NUMBER)) AS max_val
    FROM {schema_name}.{table_name}
    WHERE {column_name} IS NOT NULL
),
bucketed AS (
    SELECT
        CASE
            WHEN s.min_val = s.max_val THEN 1
            ELSE WIDTH_BUCKET(
                CAST({column_name} AS NUMBER),
                s.min_val,
                s.max_val + 0.0001,
                {buckets}
            )
        END AS bucket,
        s.min_val,
        s.max_val
    FROM {schema_name}.{table_name}, stats s
    WHERE {column_name} IS NOT NULL
)
SELECT
    bucket,
    ROUND(min_val + (bucket - 1) * (max_val - min_val) / {buckets}, 4) AS lower_bound,
    ROUND(min_val + bucket * (max_val - min_val) / {buckets}, 4)       AS upper_bound,
    COUNT(*) AS frequency
FROM bucketed
GROUP BY bucket, min_val, max_val
ORDER BY bucket
