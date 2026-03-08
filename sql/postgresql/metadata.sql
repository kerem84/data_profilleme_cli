-- Schema/tablo/kolon metadata sorgulama (pg_constraint tabanli PK/FK)
-- Value params: %(schema_name)s
SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    c.is_nullable,
    c.column_default,
    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
    pk.constraint_name AS pk_constraint,
    CASE WHEN fk.fk_column IS NOT NULL THEN true ELSE false END AS is_foreign_key,
    fk.fk_constraint,
    fk.referenced_schema,
    fk.referenced_table,
    fk.referenced_column
FROM information_schema.columns c
LEFT JOIN (
    SELECT
        n.nspname   AS table_schema,
        t.relname   AS table_name,
        a.attname   AS column_name,
        con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class     t ON con.conrelid      = t.oid
    JOIN pg_namespace n ON t.relnamespace    = n.oid
    CROSS JOIN LATERAL unnest(con.conkey) AS u(attnum)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
    WHERE con.contype = 'p'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
) pk
    ON  c.table_schema = pk.table_schema
    AND c.table_name   = pk.table_name
    AND c.column_name  = pk.column_name
LEFT JOIN (
    SELECT
        n_src.nspname  AS table_schema,
        t_src.relname  AS table_name,
        a_src.attname  AS fk_column,
        con.conname    AS fk_constraint,
        n_ref.nspname  AS referenced_schema,
        t_ref.relname  AS referenced_table,
        a_ref.attname  AS referenced_column
    FROM pg_constraint con
    JOIN pg_class     t_src ON con.conrelid       = t_src.oid
    JOIN pg_namespace n_src ON t_src.relnamespace = n_src.oid
    JOIN pg_class     t_ref ON con.confrelid       = t_ref.oid
    JOIN pg_namespace n_ref ON t_ref.relnamespace  = n_ref.oid
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS u(src_attnum, ref_attnum)
    JOIN pg_attribute a_src
        ON a_src.attrelid = t_src.oid AND a_src.attnum = u.src_attnum
    JOIN pg_attribute a_ref
        ON a_ref.attrelid = t_ref.oid AND a_ref.attnum = u.ref_attnum
    WHERE con.contype = 'f'
      AND n_src.nspname NOT IN ('pg_catalog', 'information_schema')
) fk
    ON  c.table_schema = fk.table_schema
    AND c.table_name   = fk.table_name
    AND c.column_name  = fk.fk_column
WHERE c.table_schema = %(schema_name)s::text
    AND c.table_name NOT LIKE 'pg_%%'
ORDER BY c.table_name, c.ordinal_position;
