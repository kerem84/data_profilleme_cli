-- En sik N deger
-- Identifier params: {schema_name}, {table_name}, {column_name}
-- Value params: %(total_count)s, %(top_n)s
SELECT
    {column_name}::text AS value,
    COUNT(*) AS frequency,
    ROUND(COUNT(*)::numeric / %(total_count)s, 6) AS pct
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL
GROUP BY {column_name}
ORDER BY frequency DESC
LIMIT %(top_n)s;
