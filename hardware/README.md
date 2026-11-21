# LIEU hardware control reset

Reset on 2026-11-01.

The active project currently contains no physical transport, device mapping,
motor calibration, firmware, or output command implementation. The simulator
and sequence preview remain available, but physical output is permanently
locked in the web application.

The previous implementation and calibration evidence are preserved in:

- `backups/hardware-control-before-reset-2026-11-01.zip`
- `backups/LIEU_U2D2_STARTER_2026-11-01.zip`

## Reconnection order

1. Flash `firmware/LIEU_STAGE0_DISCOVERY` and verify read-only USB identity reporting.
2. Confirm one controller and one motor ID with torque disabled.
3. Record a fresh zero/reference value without moving the motor.
4. Add one bounded, low-speed axis command and verify its feedback.
5. Repeat per axis; do not share calibration between axes.
6. Add eyes and ring only after motor communication is stable.
7. Connect timeline playback last.

Do not restore old calibration values into an active controller without a new
physical verification.

### Stage 0 invariant

`LIEU_STAGE0_DISCOVERY` contains no motor, LED, eye, I2C, Wi-Fi, or output-pin
code. It only prints a USB serial identity once per second and discards input.

### Stage 1 invariant

`LIEU_STAGE1_SHIELD_DISCOVERY` initializes only the DYNAMIXEL Shield bus. Its
only bus write is Torque Enable = 0, broadcast and repeated per discovered ID.
It may ping and read identity, position, and torque state. It cannot enable
torque or write any motion parameter or goal.

The first successful scan is recorded in `discovery/STAGE1_2026-11-01.json`.
It found four devices at IDs 1, 2, 3, and 4 with torque disabled. Axis ownership
remains deliberately unassigned.

The user-positioned torque-off zero candidates are recorded separately in
`discovery/STAGE2_ZERO_REFERENCES_2026-11-01.json`. They are references only,
not motion limits or authorization to enable torque. Rail remains command-locked.

`LIEU_STAGE2_BATCH_TELEMETRY` uses the mapped IDs to report all four raw
positions at 5 Hz while repeatedly forcing torque off. It accepts no commands
and is used to capture multiple manual direction checks in one session.

`LIEU_STAGE3_YAW_HOLD` is the first powered validation. It accepts only
`HOLD YAW`, sets the goal to the current measured position before torque-on,
holds for three seconds, monitors errors, then releases automatically. It has
also gained the separately gated `NUDGE YAW` validation after the hold test
passed: +50 raw, return to start, then release. IDs 2, 3, and 4 remain off.

`LIEU_STAGE3_TILT_HOLD` independently validates a three-second stationary hold
for ID 2. It has no movement command and keeps Yaw, Body, and Rail torque-off.

`LIEU_STAGE3_BODY_RAIL_TEST` stages stationary hold and tiny round-trip tests
for Body and Rail. Each exact command releases every axis before setup and
again on completion, timeout, or fault.

`LIEU_STAGE4_SAFE_CONTROLLER` is the first reusable controller. Yaw is limited
to its observed ±20-raw commissioning window; it permits only one active axis, enforces the powered-test windows and
per-command step limits, and releases all torque after a 750 ms host watchdog.

> Note: `firmware/LIEU_WIFI_SAFE_LOCKED/` may remain as an empty directory while
> another Windows process holds it open. It contains no active source files.
