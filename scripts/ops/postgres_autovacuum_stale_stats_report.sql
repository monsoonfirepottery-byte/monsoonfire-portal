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
with settings as (
  select current_setting('autovacuum_analyze_threshold')::numeric as analyze_threshold,
         current_setting('autovacuum_analyze_scale_factor')::numeric as analyze_scale_factor,
         current_setting('autovacuum_vacuum_threshold')::numeric as vacuum_threshold,
         current_setting('autovacuum_vacuum_scale_factor')::numeric as vacuum_scale_factor
),
stats as (
  select st.schemaname,
         st.relname,
         st.n_live_tup,
         st.n_dead_tup,
         st.n_mod_since_analyze,
         st.last_vacuum,
         st.last_autovacuum,
         st.last_analyze,
         st.last_autoanalyze,
         c.reloptions,
         ceil(settings.analyze_threshold + settings.analyze_scale_factor * greatest(st.n_live_tup, 0)) as estimated_analyze_threshold,
         ceil(settings.vacuum_threshold + settings.vacuum_scale_factor * greatest(st.n_live_tup, 0)) as estimated_vacuum_threshold
  from pg_stat_user_tables st
  join pg_class c on c.oid = st.relid
  cross join settings
)
select schemaname || '.' || relname as relation,
       n_live_tup,
       n_dead_tup,
       n_mod_since_analyze,
       estimated_analyze_threshold,
       estimated_vacuum_threshold,
       round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 2) as dead_pct,
       last_vacuum,
       last_autovacuum,
       last_analyze,
       last_autoanalyze,
       greatest(last_vacuum, last_autovacuum) as last_vacuum_any,
       greatest(last_analyze, last_autoanalyze) as last_analyze_any,
       now() - greatest(last_analyze, last_autoanalyze) as analyze_age,
       now() - greatest(last_vacuum, last_autovacuum) as vacuum_age,
       reloptions,
       case
         when greatest(last_analyze, last_autoanalyze) is null then 'never_analyzed'
         when n_mod_since_analyze >= estimated_analyze_threshold then 'analyze_threshold_reached'
         when greatest(last_analyze, last_autoanalyze) < now() - interval '7 days' and n_live_tup > 10000 then 'stale_analyze_over_7d_large'
         when n_dead_tup >= estimated_vacuum_threshold then 'vacuum_threshold_reached'
         when n_dead_tup > 10000 and n_dead_tup > n_live_tup * 0.05 then 'dead_tuple_review'
         else 'watch'
       end as review_reason
from stats
where n_live_tup > 1000
   or n_dead_tup > 1000
   or n_mod_since_analyze > 1000
order by
  case
    when greatest(last_analyze, last_autoanalyze) is null then 0
    when n_mod_since_analyze >= estimated_analyze_threshold then 1
    when greatest(last_analyze, last_autoanalyze) < now() - interval '7 days' and n_live_tup > 10000 then 2
    when n_dead_tup >= estimated_vacuum_threshold then 3
    when n_dead_tup > 10000 and n_dead_tup > n_live_tup * 0.05 then 4
    else 5
  end,
  n_dead_tup desc,
  n_mod_since_analyze desc,
  n_live_tup desc
limit 75;

\echo query:tables_with_custom_autovacuum_options
select st.schemaname || '.' || st.relname as relation,
       reloptions
from pg_stat_user_tables st
join pg_class c on c.oid = st.relid
where reloptions is not null
order by relation
limit 75;

\echo query:autovacuum_report_note
select 'This is a read-only candidate report. It identifies stale statistics and vacuum leads but does not approve VACUUM, ANALYZE, reloptions, or schema changes.' as note;
