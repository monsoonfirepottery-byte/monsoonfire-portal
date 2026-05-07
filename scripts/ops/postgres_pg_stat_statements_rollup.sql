\pset pager off
\timing on

\echo query:pg_stat_statements_visibility
with extension_row as (
  select extnamespace
  from pg_extension
  where extname = 'pg_stat_statements'
),
view_row as (
  select c.oid, n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relname = 'pg_stat_statements'
    and c.relkind in ('v', 'm')
  order by (n.oid = (select extnamespace from extension_row)) desc, n.nspname
  limit 1
)
select exists(select 1 from extension_row) as pgss_extension_installed,
       exists(select 1 from view_row) as pgss_view_visible,
       coalesce((select has_table_privilege(oid, 'SELECT') from view_row), false) as pgss_can_select,
       coalesce((select format('%I.%I', nspname, relname) from view_row), '<not visible>') as pgss_view_name,
       coalesce(position('pg_stat_statements' in current_setting('shared_preload_libraries', true)) > 0, false) as pgss_preloaded
\gset
with extension_row as (
  select extnamespace
  from pg_extension
  where extname = 'pg_stat_statements'
),
view_row as (
  select c.oid, n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relname = 'pg_stat_statements'
    and c.relkind in ('v', 'm')
  order by (n.oid = (select extnamespace from extension_row)) desc, n.nspname
  limit 1
)
select exists(select 1 from extension_row) as extension_installed,
       exists(select 1 from view_row) as view_visible,
       coalesce((select has_table_privilege(oid, 'SELECT') from view_row), false) as can_select,
       coalesce((select format('%I.%I', nspname, relname) from view_row), '<not visible>') as view_name,
       coalesce(position('pg_stat_statements' in current_setting('shared_preload_libraries', true)) > 0, false) as preloaded,
       case
         when not exists(select 1 from extension_row) then 'extension_missing'
         when not exists(select 1 from view_row) then 'view_not_visible_in_catalog'
         when not coalesce((select has_table_privilege(oid, 'SELECT') from view_row), false) then 'select_permission_missing'
         else 'available'
       end as visibility_status;

\if :pgss_can_select
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

\echo query:pg_stat_statements_query_family_rollup
with normalized as (
  select calls,
         total_exec_time,
         mean_exec_time,
         max_exec_time,
         rows,
         shared_blks_hit,
         shared_blks_read,
         temp_blks_read,
         temp_blks_written,
         case
           when query ~* '^[[:space:]]*select[[:space:]]' then 'select'
           when query ~* '^[[:space:]]*insert[[:space:]]' then 'insert'
           when query ~* '^[[:space:]]*update[[:space:]]' then 'update'
           when query ~* '^[[:space:]]*delete[[:space:]]' then 'delete'
           when query ~* '^[[:space:]]*with[[:space:]]' then 'with'
           when query ~* '^[[:space:]]*refresh[[:space:]]' then 'refresh'
           when query ~* '^[[:space:]]*create[[:space:]]' then 'create'
           else 'other'
         end as statement_kind,
         coalesce(
           nullif(substring(lower(query) from 'from[[:space:]]+([a-zA-Z0-9_".]+)'), ''),
           nullif(substring(lower(query) from 'update[[:space:]]+([a-zA-Z0-9_".]+)'), ''),
           nullif(substring(lower(query) from 'into[[:space:]]+([a-zA-Z0-9_".]+)'), ''),
           nullif(substring(lower(query) from 'join[[:space:]]+([a-zA-Z0-9_".]+)'), ''),
           '<unknown>'
         ) as primary_relation,
         left(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     lower(regexp_replace(query, E'[\n\r\t]+', ' ', 'g')),
                     E'''([^'']|'''')*''',
                     '''?''',
                     'g'
                   ),
                   E'\\$[0-9]+',
                   '$?',
                   'g'
                 ),
                 E'\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b',
                 '?',
                 'gi'
               ),
               E'\\b[0-9]+(\\.[0-9]+)?\\b',
               '?',
               'g'
             ),
             E'[[:space:]]+',
             ' ',
             'g'
           ),
           220
         ) as redacted_query_family
  from pg_stat_statements
)
select statement_kind,
       primary_relation,
       count(*) as statement_fingerprints,
       sum(calls) as calls,
       round(sum(total_exec_time)::numeric, 2) as total_exec_time_ms,
       round((sum(total_exec_time) / greatest(sum(calls), 1))::numeric, 2) as weighted_mean_exec_time_ms,
       round(max(max_exec_time)::numeric, 2) as max_exec_time_ms,
       sum(rows) as rows,
       sum(shared_blks_read) as shared_blks_read,
       sum(temp_blks_written) as temp_blks_written,
       min(redacted_query_family) as example_redacted_family
from normalized
group by statement_kind, primary_relation
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
select case
         when :'pgss_extension_installed' <> 't' then 'pg_stat_statements extension is not installed in this database'
         when :'pgss_view_visible' <> 't' then 'pg_stat_statements view is not visible in this search path/catalog'
         when :'pgss_can_select' <> 't' then 'current role cannot SELECT from pg_stat_statements'
         else 'pg_stat_statements unavailable for an unknown visibility reason'
       end as status,
       'Grant a read-only monitoring role SELECT on pg_stat_statements, or rerun with a role that can view it. No schema changes are required for this packet.' as next_step;
\endif
