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

\echo query:connection_capacity
select current_setting('max_connections')::int as max_connections,
       count(*) as current_connections,
       round(100.0 * count(*) / greatest(current_setting('max_connections')::int, 1), 2) as connection_pct
from pg_stat_activity;

\echo query:connection_by_database_user_app
select datname,
       usename,
       application_name,
       coalesce(client_addr::text, 'local') as client_addr,
       coalesce(state, '<null>') as state,
       count(*) as connections
from pg_stat_activity
group by 1, 2, 3, 4, 5
order by connections desc, datname, usename, application_name, state
limit 40;

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

\echo query:idle_in_transaction
select pid,
       usename,
       application_name,
       coalesce(client_addr::text, 'local') as client_addr,
       now() - xact_start as xact_age,
       now() - state_change as state_age,
       wait_event_type,
       wait_event,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 160) as query
from pg_stat_activity
where state = 'idle in transaction'
order by xact_start nulls last
limit 20;

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

\echo query:blocking_locks
select blocked.pid as blocked_pid,
       blocked.usename as blocked_user,
       blocking.pid as blocking_pid,
       blocking.usename as blocking_user,
       now() - blocked.query_start as blocked_age,
       left(regexp_replace(blocked.query, E'[\n\r\t]+', ' ', 'g'), 160) as blocked_query,
       left(regexp_replace(blocking.query, E'[\n\r\t]+', ' ', 'g'), 160) as blocking_query
from pg_stat_activity blocked
join pg_locks blocked_locks on blocked_locks.pid = blocked.pid and not blocked_locks.granted
join pg_locks blocking_locks on blocking_locks.locktype = blocked_locks.locktype
  and blocking_locks.database is not distinct from blocked_locks.database
  and blocking_locks.relation is not distinct from blocked_locks.relation
  and blocking_locks.page is not distinct from blocked_locks.page
  and blocking_locks.tuple is not distinct from blocked_locks.tuple
  and blocking_locks.virtualxid is not distinct from blocked_locks.virtualxid
  and blocking_locks.transactionid is not distinct from blocked_locks.transactionid
  and blocking_locks.classid is not distinct from blocked_locks.classid
  and blocking_locks.objid is not distinct from blocked_locks.objid
  and blocking_locks.objsubid is not distinct from blocked_locks.objsubid
  and blocking_locks.pid <> blocked_locks.pid
  and blocking_locks.granted
join pg_stat_activity blocking on blocking.pid = blocking_locks.pid
order by blocked.query_start nulls last
limit 20;

\echo query:roles_redacted
select rolname,
       rolcanlogin,
       rolsuper,
       rolcreaterole,
       rolcreatedb,
       rolreplication,
       rolbypassrls,
       rolconnlimit
from pg_roles
order by rolsuper desc, rolcanlogin desc, rolname;

\echo query:pg_stat_statements_available
select exists (
  select 1
  from pg_extension
  where extname = 'pg_stat_statements'
) as pg_stat_statements_available
\gset
select :'pg_stat_statements_available' as pg_stat_statements_available;

\if :pg_stat_statements_available
\echo query:pg_stat_statements_top_total_time
select calls,
       round(total_exec_time::numeric, 2) as total_exec_time_ms,
       round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
       rows,
       shared_blks_hit,
       shared_blks_read,
       temp_blks_written,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 180) as query
from pg_stat_statements
order by total_exec_time desc
limit 20;
\else
\echo query:pg_stat_statements_top_total_time
select 'pg_stat_statements extension is not installed in this database' as status;
\endif

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
