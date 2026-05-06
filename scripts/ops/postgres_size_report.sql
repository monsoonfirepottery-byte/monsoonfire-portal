\pset pager off

\echo query:database_sizes
select datname,
       pg_size_pretty(pg_database_size(datname)) as size,
       pg_database_size(datname) as bytes
from pg_database
order by bytes desc;

\echo query:schema_sizes
select nspname as schema,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total_size,
       sum(pg_total_relation_size(c.oid)) as bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema')
group by nspname
order by bytes desc;

\echo query:relation_sizes
select schemaname || '.' || relname as relation,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       pg_size_pretty(pg_relation_size(relid)) as table_size,
       pg_size_pretty(pg_indexes_size(relid)) as index_size,
       n_live_tup,
       n_dead_tup
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 50;
