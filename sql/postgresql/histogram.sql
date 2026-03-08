-- Numerik histogram (PostgreSQL)
-- Identifier params: {schema_name}, {table_name}, {column_name}
-- Literal substitution: {buckets}
WITH stats AS (
    SELECT
        MIN({column_name}::numeric) AS min_val,
        MAX({column_name}::numeric) AS max_val
    FROM {schema_name}.{table_name}
    WHERE {column_name} IS NOT NULL
),
histogram AS (
    SELECT
        WIDTH_BUCKET({column_name}::numeric, s.min_val, s.max_val + 0.0001, {buckets}) AS bucket,
        COUNT(*) AS freq
    FROM {schema_name}.{table_name} t, stats s
    WHERE {column_name} IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
)
SELECT
    h.bucket,
    s.min_val + (h.bucket - 1) * (s.max_val - s.min_val) / {buckets} AS lower_bound,
    s.min_val + h.bucket * (s.max_val - s.min_val) / {buckets} AS upper_bound,
    h.freq
FROM histogram h, stats s
ORDER BY h.bucket;
