-- Min/max degerler
-- Identifier params: {schema_name}, {table_name}, {column_name}
SELECT
    MIN(CAST({column_name} AS NVARCHAR(MAX))) AS min_value,
    MAX(CAST({column_name} AS NVARCHAR(MAX))) AS max_value
FROM {schema_name}.{table_name} WITH (NOLOCK)
WHERE {column_name} IS NOT NULL;
