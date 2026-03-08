-- MSSQL schema/tablo/kolon metadata
-- Value params: ? (schema_name)
SELECT
    s.name AS table_schema,
    t.name AS table_name,
    c.name AS column_name,
    c.column_id AS ordinal_position,
    tp.name AS data_type,
    CASE
        WHEN tp.name IN ('nvarchar', 'nchar') AND c.max_length > 0
            THEN c.max_length / 2
        ELSE c.max_length
    END AS character_maximum_length,
    c.precision AS numeric_precision,
    c.scale AS numeric_scale,
    CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
    dc.definition AS column_default,
    CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
    pk.pk_name AS pk_constraint,
    CASE WHEN fkc.parent_column_id IS NOT NULL THEN 1 ELSE 0 END AS is_foreign_key,
    fk_obj.name AS fk_constraint,
    rs.name AS referenced_schema,
    rt.name AS referenced_table,
    rc.name AS referenced_column
FROM sys.columns c
INNER JOIN sys.tables t ON c.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN (
    SELECT ic.object_id, ic.column_id, i.name AS pk_name
    FROM sys.index_columns ic
    INNER JOIN sys.indexes i
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.is_primary_key = 1
) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
LEFT JOIN sys.foreign_key_columns fkc
    ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
LEFT JOIN sys.foreign_keys fk_obj
    ON fkc.constraint_object_id = fk_obj.object_id
LEFT JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
LEFT JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
LEFT JOIN sys.columns rc
    ON fkc.referenced_object_id = rc.object_id
    AND fkc.referenced_column_id = rc.column_id
WHERE s.name = ?
ORDER BY t.name, c.column_id;
