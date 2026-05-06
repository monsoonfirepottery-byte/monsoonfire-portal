\pset pager off
\timing on

\echo query:growth_snapshot_metadata
select now() at time zone 'utc' as captured_at_utc,
       current_database() as database_name,
       current_user as captured_by;

\echo query:database_growth_snapshot
select datname,
       pg_database_size(datname) as bytes,
       pg_size_pretty(pg_database_size(datname)) as size
from pg_database
order by bytes desc;

\echo query:schema_growth_snapshot
select n.nspname as schema_name,
       sum(pg_total_relation_size(c.oid)) as total_bytes,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total_size,
       count(*) filter (where c.relkind in ('r', 'p')) as table_count,
       count(*) filter (where c.relkind = 'i') as index_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and c.relkind in ('r', 'p', 'm', 'i')
group by n.nspname
order by total_bytes desc;

\echo query:relation_growth_snapshot
select schemaname || '.' || relname as relation,
       pg_total_relation_size(relid) as total_bytes,
       pg_relation_size(relid) as table_bytes,
       pg_indexes_size(relid) as index_bytes,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       n_live_tup,
       n_dead_tup,
       last_autovacuum,
       last_autoanalyze
from pg_stat_user_tables
order by total_bytes desc
limit 75;

\echo query:trend_note
select 'Store this output weekly; compute deltas outside production with captured_at_utc + relation total_bytes.' as note;
