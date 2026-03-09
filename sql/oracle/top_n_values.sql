SELECT
    CAST({column_name} AS VARCHAR2(4000)) AS value,
    COUNT(*)                              AS frequency,
    ROUND(CAST(COUNT(*) AS NUMBER) / :total_count, 6) AS pct
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL
GROUP BY {column_name}
ORDER BY frequency DESC
FETCH FIRST :top_n ROWS ONLY
