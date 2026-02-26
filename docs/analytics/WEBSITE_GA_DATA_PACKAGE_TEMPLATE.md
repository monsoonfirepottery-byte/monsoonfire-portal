# Website GA Data Package Template

## Retrieval metadata
- Retrieval date (UTC):
- GA property:
- Export owner:
- Date windows exported:
  - 30d rolling
  - 90d rolling
  - prior year same period (if available)

## Required export set
| Export | Required columns |
|---|---|
| Top Acquisition Channels | date, source_medium, source_type, sessions, goal_conversions, conversion_rate, avg_engagement_time |
| Landing pages | page_path, sessions, bounces, bounce_rate, exit_rate, goal_start_rate, goal_completion_rate |
| Path to conversion | conversion_path, step_index, step_name, dropoff_count, completion_count |
| Event audit | event_name, first_seen, last_seen, day, event_count, unique_events, event_value |
| Goal table | goal_name, funnel_steps, completion_rate, device_category, top_referrers |

## Quality checks
1. Totals reconcile with GA overview for each exported window.
2. Date ranges are explicit in each export filename.
3. Units and filters are documented for each export.
4. Missing permissions are captured in a blocker note.

## Notes
- Keep raw exports unmodified.
- Store normalized copies in the same baseline folder with a `normalized-` prefix.
