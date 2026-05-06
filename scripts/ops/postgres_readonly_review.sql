\pset pager off
\timing on

\echo query:version
select current_database() as db, current_user as current_user, version();

\echo query:settings
select name, setting, coalesce(unit, '') as unit, source
from pg_settings
where name in (
  'max_connections',
  'shared_buffers',
  'work_mem',
  'maintenance_work_mem',
  'effective_cache_size',
  'wal_level',
  'max_wal_size',
  'min_wal_size',
  'checkpoint_timeout',
  'autovacuum',
  'track_io_timing',
  'shared_preload_libraries'
)
order by name;

\echo query:database_sizes
select datname,
       pg_size_pretty(pg_database_size(datname)) as size,
       pg_database_size(datname) as bytes
from pg_database
order by bytes desc;

\echo query:extensions
select extname, extversion
from pg_extension
order by extname;

\echo query:activity_state
select coalesce(state, '<null>') as state, count(*)
from pg_stat_activity
group by 1
order by 2 desc;

\echo query:active_activity
select pid,
       usename,
       state,
       now() - query_start as query_age,
       now() - xact_start as xact_age,
       wait_event_type,
       wait_event,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 160) as query
from pg_stat_activity
where state <> 'idle'
order by query_start nulls last
limit 15;

\echo query:largest_tables
select schemaname || '.' || relname as relation,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       pg_size_pretty(pg_relation_size(relid)) as table_size,
       pg_size_pretty(pg_indexes_size(relid)) as index_size,
       n_live_tup,
       n_dead_tup,
       last_autovacuum,
       last_autoanalyze
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 20;

\echo query:largest_indexes
select schemaname || '.' || indexrelname as index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch
from pg_stat_user_indexes
order by pg_relation_size(indexrelid) desc
limit 20;

\echo query:dead_tuples
select schemaname || '.' || relname as relation,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 2) as dead_pct,
       last_vacuum,
       last_autovacuum,
       last_analyze,
       last_autoanalyze
from pg_stat_user_tables
order by n_dead_tup desc
limit 20;

\echo query:locks
select locktype, mode, granted, count(*)
from pg_locks
group by 1, 2, 3
order by granted, count(*) desc;

\echo query:wal
select wal_records, wal_fpi, wal_bytes, wal_buffers_full, wal_write, wal_sync
from pg_stat_wal;

\echo query:bgwriter
select checkpoints_timed,
       checkpoints_req,
       checkpoint_write_time,
       checkpoint_sync_time,
       buffers_checkpoint,
       buffers_clean,
       maxwritten_clean,
       buffers_backend
from pg_stat_bgwriter;
