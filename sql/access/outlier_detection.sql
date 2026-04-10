-- Outlier tespiti icin siralanmis veri cekimi
-- Identifier params: {table_name}, {column_name}
-- Not: IQR hesabi Node.js-side yapilir
SELECT CDbl({column_name}) AS val
FROM {table_name}
WHERE {column_name} IS NOT NULL
ORDER BY {column_name};
