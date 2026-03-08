-- NULL orani ve distinct sayisi
-- Identifier params: {schema_name}, {table_name}, {column_name}
SELECT
    COUNT(*) AS total_count,
    COUNT({column_name}) AS non_null_count,
    COUNT(*) - COUNT({column_name}) AS null_count,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(CAST(COUNT(*) - COUNT({column_name}) AS NUMERIC) / COUNT(*), 6)
         ELSE 0 END AS null_ratio,
    COUNT(DISTINCT {column_name}) AS distinct_count,
    CASE WHEN COUNT({column_name}) > 0
         THEN ROUND(CAST(COUNT(DISTINCT {column_name}) AS NUMERIC) / COUNT({column_name}), 6)
         ELSE 0 END AS distinct_ratio
FROM {schema_name}.{table_name} WITH (NOLOCK);
