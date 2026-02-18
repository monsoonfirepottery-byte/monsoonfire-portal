# GA data package: extraction template and access protocol

Status: Planned
Priority: P1
Severity: Sev3
Component: website
Impact: high
Tags: website, analytics, data, reporting

## Problem statement
Current analysis lacks direct GA access here, so the first step must be a standardized extraction process with clear metric definitions and retention to avoid guessing.

## Proposed solution
Create a repeatable GA data handoff so every analyst session has a complete baseline and comparable trend set.

## Data package scope
- Date windows:
  - 30 days rolling (primary)
  - 90 days rolling (trend)
  - Prior year same period (if available)
- Required sections:
  - Audience overview (sessions, users, returning vs new)
  - Acquisition (`source/medium`, campaign, channel grouping)
  - Behavior (`landing page`, `behavior flow`, `site search` if enabled)
  - Conversions (`goal completions`, funnel visualization, reverse path)
  - Events (`event name`, count, unique events, event value)
  - Tech and device (`device category`, browser, mobile app/web split if available)

## Required exports to capture
1. `Top Acquisition Channels`  
   Columns: date, source/medium, source type, sessions, goal conversions, conversion rate, avg engagement time.
2. `Landing pages`  
   Columns: page path, sessions, bounces, bounce rate, exit rate, goal start rate, goal completion rate.
3. `Path to conversion`  
   Top 20 conversion paths with drop-off points.
4. `Event audit`  
   Event name inventory with first seen/last seen and count by day.
5. `Goal table`  
   Goal name, steps, completion rate, device split, top referrers.

## Acceptance criteria
- A single folder or document exists containing all 5 required exports for all windows.
- Exports are dated and include raw date of retrieval.
- A named owner and timestamped analyst note are attached to each file.
- Data schema notes include units, date window, and known GA property filters.
- Any missing report/export permissions are captured as blockers in a known issues section.

## Responsibilities
- Marketing owner: campaign and source/medium tagging context.
- Analytics owner: extraction and consistency validation.
- Product owner: mapping to conversion hypotheses and tickets.

## Manual execution checklist
1. Generate and export reports from the live GA property with same date windows.
2. Normalize into one file format and upload to shared location.
3. Reconcile totals with GA property homepage overview totals.
4. Flag all anomalies for follow-up in `P1-website-ga-event-and-goal-instrumentation-completeness.md`.
