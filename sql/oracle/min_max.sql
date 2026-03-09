SELECT
    CAST(MIN({column_name}) AS VARCHAR2(4000)) AS min_value,
    CAST(MAX({column_name}) AS VARCHAR2(4000)) AS max_value
FROM {schema_name}.{table_name}
WHERE {column_name} IS NOT NULL
