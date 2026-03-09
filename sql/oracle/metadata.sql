SELECT
    c.table_name,
    c.column_name,
    LOWER(c.data_type)                                AS data_type,
    c.data_length                                     AS max_length,
    CASE WHEN c.nullable = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable,
    c.column_id                                       AS ordinal_position,
    CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
    CASE WHEN fk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_foreign_key,
    pk.constraint_name                                AS pk_constraint,
    fk.constraint_name                                AS fk_constraint,
    fk.r_owner                                        AS referenced_schema,
    fk.r_table_name                                   AS referenced_table,
    fk.r_column_name                                  AS referenced_column
FROM all_tab_columns c
LEFT JOIN (
    SELECT acc.owner, acc.table_name, acc.column_name, acc.constraint_name
    FROM all_cons_columns acc
    INNER JOIN all_constraints ac
        ON acc.owner = ac.owner
       AND acc.constraint_name = ac.constraint_name
    WHERE ac.constraint_type = 'P'
) pk ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name
LEFT JOIN (
    SELECT
        acc.owner, acc.table_name, acc.column_name, acc.constraint_name,
        rc.owner AS r_owner,
        rc_cols.table_name AS r_table_name,
        rc_cols.column_name AS r_column_name
    FROM all_cons_columns acc
    INNER JOIN all_constraints ac
        ON acc.owner = ac.owner
       AND acc.constraint_name = ac.constraint_name
    INNER JOIN all_constraints rc
        ON ac.r_owner = rc.owner
       AND ac.r_constraint_name = rc.constraint_name
    INNER JOIN all_cons_columns rc_cols
        ON rc.owner = rc_cols.owner
       AND rc.constraint_name = rc_cols.constraint_name
       AND acc.position = rc_cols.position
    WHERE ac.constraint_type = 'R'
) fk ON fk.owner = c.owner AND fk.table_name = c.table_name AND fk.column_name = c.column_name
WHERE c.owner = :schema_name
ORDER BY c.table_name, c.column_id
