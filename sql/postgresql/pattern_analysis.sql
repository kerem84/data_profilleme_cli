-- String kolon pattern analizi
-- Identifier params: {schema_name}, {table_name}, {column_name}
-- Dynamic param: {pattern_cases} (Python tarafindan olusturulur)
-- Value params: %(max_sample)s
SELECT
    COUNT(*) AS sample_size,
    {pattern_cases}
FROM (
    SELECT {column_name}::text AS val
    FROM {schema_name}.{table_name}
    WHERE {column_name} IS NOT NULL
    LIMIT %(max_sample)s
) sub;
