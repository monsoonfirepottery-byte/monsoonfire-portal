\pset pager off
\timing on

\echo query:pg_stat_statements_extension
select exists (
  select 1
  from pg_extension
  where extname = 'pg_stat_statements'
) as pg_stat_statements_available
\gset
select :'pg_stat_statements_available' as pg_stat_statements_available;

\if :pg_stat_statements_available
\echo query:pg_stat_statements_rollup_by_database_user
select d.datname,
       r.rolname as role_name,
       count(*) as statement_fingerprints,
       sum(calls) as calls,
       round(sum(total_exec_time)::numeric, 2) as total_exec_time_ms,
       round((sum(total_exec_time) / greatest(sum(calls), 1))::numeric, 2) as weighted_mean_exec_time_ms,
       sum(rows) as rows,
       sum(shared_blks_hit) as shared_blks_hit,
       sum(shared_blks_read) as shared_blks_read,
       sum(temp_blks_read) as temp_blks_read,
       sum(temp_blks_written) as temp_blks_written
from pg_stat_statements s
left join pg_database d on d.oid = s.dbid
left join pg_roles r on r.oid = s.userid
group by d.datname, r.rolname
order by total_exec_time_ms desc nulls last
limit 40;

\echo query:pg_stat_statements_top_total_time
select calls,
       round(total_exec_time::numeric, 2) as total_exec_time_ms,
       round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
       round(max_exec_time::numeric, 2) as max_exec_time_ms,
       rows,
       shared_blks_hit,
       shared_blks_read,
       temp_blks_written,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 220) as query_redacted_fingerprint
from pg_stat_statements
order by total_exec_time desc
limit 25;

\echo query:pg_stat_statements_top_mean_time_min_5_calls
select calls,
       round(total_exec_time::numeric, 2) as total_exec_time_ms,
       round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
       round(max_exec_time::numeric, 2) as max_exec_time_ms,
       rows,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 220) as query_redacted_fingerprint
from pg_stat_statements
where calls >= 5
order by mean_exec_time desc
limit 25;
\else
\echo query:pg_stat_statements_rollup
select 'pg_stat_statements extension is not installed in this database' as status;
\endif
