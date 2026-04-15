# Kiln Operator Workflows

## Start Workflow

Studio Brain coordinates; the operator still starts the kiln locally.

1. Create or stage a `FiringRun`.
2. Attach suggested program and queue metadata.
3. Record `loaded_kiln`.
4. Record `verified_clearance`.
5. Record `pressed_start` only after the local controller start is actually pressed.
6. Studio Brain moves the run to `firing` and marks posture as `Human-triggered`.

## Mid-Fire Workflow

When telemetry or imported logs exist, Studio Brain can:

- mirror segment, set point, and current temperature
- estimate remaining time
- flag zone spread and heat-up anomalies
- surface advisory SOP notes
- collect operator notes or observed error codes

Studio Brain does not claim to start, stop, or reprogram Genesis remotely.

## Completion Workflow

1. Imported evidence or operator input moves the run to `cooling` or `ready_for_unload`.
2. Operator records `opened_kiln` and `completed_unload`.
3. Studio Brain closes the run, updates health analytics, and preserves the raw evidence trail.

## Manual Event Vocabulary

The MVP supports fast operator capture for:

- `loaded_kiln`
- `verified_clearance`
- `pressed_start`
- `observed_error_code`
- `opened_kiln`
- `completed_unload`
- `relay_replaced`
- `thermocouple_replaced`
- `manual_note`

## Queue States

Operational queue state is separate from run status:

- `intake`
- `staged`
- `ready_for_program`
- `ready_for_start`
- `firing`
- `cooling`
- `ready_for_unload`
- `complete`
- `exception`

This keeps human workflow honest even when controller evidence arrives late or partially.
