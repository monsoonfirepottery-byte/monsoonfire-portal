\pset pager off
\timing on

\echo query:lock_packet_metadata
select now() at time zone 'utc' as captured_at_utc,
       current_database() as database_name,
       current_user as captured_by,
       'read_only_long_transaction_lock_packet' as scope,
       'query text may be hidden by PostgreSQL privileges; this packet does not terminate sessions or change locks' as privilege_note;

\echo query:long_running_transactions
select pid,
       datname,
       usename,
       application_name,
       coalesce(client_addr::text, 'local') as client_addr,
       coalesce(state, '<null>') as state,
       now() - xact_start as xact_age,
       now() - query_start as query_age,
       now() - state_change as state_age,
       wait_event_type,
       wait_event,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 220) as query_redacted_or_privilege_limited
from pg_stat_activity
where xact_start is not null
order by xact_start nulls last
limit 50;

\echo query:idle_in_transaction_packet
select pid,
       datname,
       usename,
       application_name,
       coalesce(client_addr::text, 'local') as client_addr,
       now() - xact_start as xact_age,
       now() - state_change as idle_age,
       wait_event_type,
       wait_event,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 220) as query_redacted_or_privilege_limited
from pg_stat_activity
where state = 'idle in transaction'
order by xact_start nulls last
limit 50;

\echo query:waiting_activity
select pid,
       datname,
       usename,
       application_name,
       coalesce(client_addr::text, 'local') as client_addr,
       coalesce(state, '<null>') as state,
       now() - query_start as wait_age,
       wait_event_type,
       wait_event,
       pg_blocking_pids(pid) as blocking_pids,
       left(regexp_replace(query, E'[\n\r\t]+', ' ', 'g'), 220) as query_redacted_or_privilege_limited
from pg_stat_activity
where wait_event_type is not null
   or cardinality(pg_blocking_pids(pid)) > 0
order by query_start nulls last
limit 50;

\echo query:blocking_lock_pairs
select blocked.pid as blocked_pid,
       blocked.usename as blocked_user,
       blocked.application_name as blocked_application,
       blocking.pid as blocking_pid,
       blocking.usename as blocking_user,
       blocking.application_name as blocking_application,
       now() - blocked.query_start as blocked_age,
       blocked_locks.locktype,
       blocked_locks.mode as blocked_mode,
       blocking_locks.mode as blocking_mode,
       coalesce(ns.nspname || '.' || cls.relname, '<not relation lock>') as relation,
       left(regexp_replace(blocked.query, E'[\n\r\t]+', ' ', 'g'), 220) as blocked_query_redacted_or_privilege_limited,
       left(regexp_replace(blocking.query, E'[\n\r\t]+', ' ', 'g'), 220) as blocking_query_redacted_or_privilege_limited
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
left join pg_class cls on cls.oid = blocked_locks.relation
left join pg_namespace ns on ns.oid = cls.relnamespace
order by blocked.query_start nulls last
limit 50;

\echo query:lock_mode_summary
select locktype,
       mode,
       granted,
       count(*) as lock_count
from pg_locks
group by locktype, mode, granted
order by granted, lock_count desc, locktype, mode;

\echo query:relation_lock_summary
select coalesce(ns.nspname || '.' || cls.relname, '<not relation lock>') as relation,
       mode,
       granted,
       count(*) as lock_count
from pg_locks locks
left join pg_class cls on cls.oid = locks.relation
left join pg_namespace ns on ns.oid = cls.relnamespace
where locks.relation is not null
group by 1, 2, 3
order by granted, lock_count desc, relation, mode
limit 100;

\echo query:prepared_transactions
select gid,
       prepared,
       owner,
       database,
       now() - prepared as prepared_age
from pg_prepared_xacts
order by prepared
limit 50;

\echo query:lock_packet_note
select 'Read-only triage only. Do not terminate backends, cancel queries, change timeouts, or run VACUUM/DDL without a separate approval packet.' as note;
