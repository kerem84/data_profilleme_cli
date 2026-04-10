-- Min/max degerler
-- Identifier params: {table_name}, {column_name}
SELECT
    CStr(MIN([{column_name}])) AS min_value,
    CStr(MAX([{column_name}])) AS max_value
FROM [{table_name}]
WHERE [{column_name}] IS NOT NULL;
