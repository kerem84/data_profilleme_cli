-- En sik N deger
-- Identifier params: {table_name}, {column_name}
-- Literal params: {top_n}, {total_count}
SELECT TOP {top_n}
    CStr([{column_name}]) AS value,
    COUNT(*) AS frequency,
    ROUND(COUNT(*) / CDbl({total_count}), 6) AS pct
FROM [{table_name}]
WHERE [{column_name}] IS NOT NULL
GROUP BY [{column_name}]
ORDER BY COUNT(*) DESC;
