-- NULL orani ve distinct sayisi
-- Identifier params: {schema_name}, {table_name}, {column_name}
SELECT
    COUNT(*) AS total_count,
    COUNT({column_name}) AS non_null_count,
    COUNT(*) - COUNT({column_name}) AS null_count,
    CASE WHEN COUNT(*) > 0
         THEN ROUND((COUNT(*) - COUNT({column_name}))::numeric / COUNT(*), 6)
         ELSE 0 END AS null_ratio,
    COUNT(DISTINCT {column_name}) AS distinct_count,
    CASE WHEN COUNT({column_name}) > 0
         THEN ROUND(COUNT(DISTINCT {column_name})::numeric / COUNT({column_name}), 6)
         ELSE 0 END AS distinct_ratio
FROM {schema_name}.{table_name};
