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

\echo query:index_growth_snapshot
select schemaname || '.' || indexrelname as index_name,
       schemaname || '.' || relname as table_name,
       pg_relation_size(indexrelid) as index_bytes,
       pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch
from pg_stat_user_indexes
order by index_bytes desc
limit 75;

\echo query:relation_index_ratio_review
select schemaname || '.' || relname as relation,
       pg_total_relation_size(relid) as total_bytes,
       pg_relation_size(relid) as table_bytes,
       pg_indexes_size(relid) as index_bytes,
       round(100.0 * pg_indexes_size(relid) / greatest(pg_total_relation_size(relid), 1), 2) as index_pct_of_total,
       n_live_tup,
       n_dead_tup
from pg_stat_user_tables
where pg_total_relation_size(relid) > 0
order by index_pct_of_total desc, index_bytes desc
limit 75;

\echo query:trend_note
select 'Store this output weekly; compute deltas outside production with captured_at_utc plus database, schema, relation, and index bytes.' as note;
