-- Min/max degerler
-- Identifier params: {schema_name}, {table_name}, {column_name}
SELECT
    MIN({column_name}::text) AS min_value,
    MAX({column_name}::text) AS max_value
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL;
