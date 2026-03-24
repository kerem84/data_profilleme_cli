-- HANA BW metadata: kolon bilgisi + BW aciklamalari
-- Value params: ? (lang_code), ? (schema_name)
-- RSDIOBJT.IOBJNM /BIC/ prefix'siz tutulur, JOIN'de REPLACE ile cikarilir
SELECT
    c.TABLE_NAME                                          AS table_name,
    c.COLUMN_NAME                                         AS column_name,
    LOWER(c.DATA_TYPE_NAME)                               AS data_type,
    c.LENGTH                                              AS character_maximum_length,
    CASE WHEN c.IS_NULLABLE = 'TRUE' THEN 'YES' ELSE 'NO' END AS is_nullable,
    c.POSITION                                            AS ordinal_position,
    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
    0                                                     AS is_foreign_key,
    pk.CONSTRAINT_NAME                                    AS pk_constraint,
    NULL                                                  AS fk_constraint,
    NULL                                                  AS referenced_schema,
    NULL                                                  AS referenced_table,
    NULL                                                  AS referenced_column,
    dt.TXTLG                                              AS column_description
FROM TABLE_COLUMNS c
LEFT JOIN (
    SELECT cc.SCHEMA_NAME, cc.TABLE_NAME, cc.COLUMN_NAME, cc.CONSTRAINT_NAME
    FROM CONSTRAINTS cc
    WHERE cc.IS_PRIMARY_KEY = 'TRUE'
) pk ON pk.SCHEMA_NAME = c.SCHEMA_NAME
    AND pk.TABLE_NAME = c.TABLE_NAME
    AND pk.COLUMN_NAME = c.COLUMN_NAME
LEFT JOIN RSDIOBJT dt
    ON REPLACE(UPPER(c.COLUMN_NAME), '/BIC/', '') = dt.IOBJNM
    AND dt.OBJVERS = 'A'
    AND dt.LANGU = ?
WHERE c.SCHEMA_NAME = ?
ORDER BY c.TABLE_NAME, c.POSITION
