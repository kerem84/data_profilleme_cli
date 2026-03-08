-- En sik N deger
-- Identifier params: {schema_name}, {table_name}, {column_name}
-- Value params: ? (top_n), ? (total_count)
SELECT TOP (?)
    CAST({column_name} AS NVARCHAR(MAX)) AS value,
    COUNT(*) AS frequency,
    ROUND(CAST(COUNT(*) AS NUMERIC) / ?, 6) AS pct
FROM {schema_name}.{table_name} WITH (NOLOCK)
WHERE {column_name} IS NOT NULL
GROUP BY {column_name}
ORDER BY frequency DESC;
