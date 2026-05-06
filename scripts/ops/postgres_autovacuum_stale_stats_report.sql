\pset pager off
\timing on

\echo query:autovacuum_settings
select name, setting, coalesce(unit, '') as unit, source
from pg_settings
where name in (
  'autovacuum',
  'autovacuum_analyze_scale_factor',
  'autovacuum_analyze_threshold',
  'autovacuum_vacuum_scale_factor',
  'autovacuum_vacuum_threshold',
  'autovacuum_naptime',
  'autovacuum_max_workers'
)
order by name;

\echo query:stale_stats_candidates
select schemaname || '.' || relname as relation,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 2) as dead_pct,
       last_vacuum,
       last_autovacuum,
       last_analyze,
       last_autoanalyze,
       greatest(last_vacuum, last_autovacuum) as last_vacuum_any,
       greatest(last_analyze, last_autoanalyze) as last_analyze_any,
       case
         when greatest(last_analyze, last_autoanalyze) is null then 'never_analyzed'
         when greatest(last_analyze, last_autoanalyze) < now() - interval '7 days' and n_live_tup > 10000 then 'stale_analyze_over_7d_large'
         when n_dead_tup > 10000 and n_dead_tup > n_live_tup * 0.05 then 'dead_tuple_review'
         else 'watch'
       end as review_reason
from pg_stat_user_tables
where n_live_tup > 1000
   or n_dead_tup > 1000
order by
  case
    when greatest(last_analyze, last_autoanalyze) is null then 0
    when greatest(last_analyze, last_autoanalyze) < now() - interval '7 days' and n_live_tup > 10000 then 1
    when n_dead_tup > 10000 and n_dead_tup > n_live_tup * 0.05 then 2
    else 3
  end,
  n_dead_tup desc,
  n_live_tup desc
limit 75;

\echo query:tables_without_autovacuum_options
select st.schemaname || '.' || st.relname as relation,
       reloptions
from pg_stat_user_tables st
join pg_class c on c.oid = st.relid
where reloptions is not null
order by relation
limit 75;
