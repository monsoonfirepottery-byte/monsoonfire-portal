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
\echo query:issue_ready_hotspots
with hotspots as (
  select row_number() over (order by total_exec_time desc) as rank,
         calls,
         round(total_exec_time::numeric, 2) as total_exec_time_ms,
         round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
         round(max_exec_time::numeric, 2) as max_exec_time_ms,
         rows,
         shared_blks_hit,
         shared_blks_read,
         temp_blks_written,
         left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 360) as query_redacted_fingerprint
  from pg_stat_statements
  order by total_exec_time desc
  limit 10
)
select format(
         '### DB hotspot #%s%s- Evidence: calls=%s total_exec_time_ms=%s mean_exec_time_ms=%s max_exec_time_ms=%s rows=%s shared_read=%s temp_written=%s%s- Fingerprint: `%s`%s- Request: capture approved EXPLAIN (ANALYZE, BUFFERS) with literals scrubbed before proposing indexes or query rewrites.%s',
         rank,
         E'\n',
         calls,
         total_exec_time_ms,
         mean_exec_time_ms,
         max_exec_time_ms,
         rows,
         shared_blks_read,
         temp_blks_written,
         E'\n',
         replace(query_redacted_fingerprint, '`', ''''),
         E'\n',
         E'\n'
       ) as issue_ready_markdown
from hotspots
order by rank;
\else
\echo query:issue_ready_hotspots
select 'pg_stat_statements extension is not installed; cannot generate hotspot issues.' as issue_ready_markdown;
\endif
