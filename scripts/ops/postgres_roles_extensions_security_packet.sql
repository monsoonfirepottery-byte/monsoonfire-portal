\pset pager off
\timing on

\echo query:roles_redacted_security_flags
select rolname,
       rolcanlogin,
       rolsuper,
       rolcreaterole,
       rolcreatedb,
       rolreplication,
       rolbypassrls,
       rolconnlimit,
       case
         when rolsuper then 'review_superuser'
         when rolbypassrls then 'review_bypassrls'
         when rolcreaterole or rolcreatedb or rolreplication then 'review_elevated_role'
         when rolcanlogin and rolconnlimit = -1 then 'review_unlimited_login'
         else 'baseline'
       end as review_flag
from pg_roles
order by
  rolsuper desc,
  rolbypassrls desc,
  rolcreaterole desc,
  rolcreatedb desc,
  rolreplication desc,
  rolcanlogin desc,
  rolname;

\echo query:role_memberships_redacted
select roleid::regrole::text as granted_role,
       member::regrole::text as member_role,
       grantor::regrole::text as grantor_role,
       admin_option
from pg_auth_members
order by granted_role, member_role;

\echo query:extensions_security_inventory
select e.extname,
       e.extversion,
       n.nspname as schema_name,
       obj_description(e.oid, 'pg_extension') as description
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
order by e.extname;

\echo query:extension_available_update_check
select installed.extname,
       installed.extversion as installed_version,
       available.default_version,
       case
         when installed.extversion = available.default_version then 'current_default'
         else 'version_differs_from_default_review'
       end as review_flag
from pg_extension installed
join pg_available_extensions available on available.name = installed.extname
order by installed.extname;

\echo query:security_packet_note
select 'Redacted role and extension inventory only. Do not include passwords, env values, or connection strings in tickets.' as note;
