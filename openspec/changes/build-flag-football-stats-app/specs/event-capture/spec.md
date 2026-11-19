## Purpose

Define how plays are recorded during a game: which fields are visible and mandatory per play type, how lineups carry over, how the extra-point phase works and how mistakes are corrected without losing history.

## ADDED Requirements

### Requirement: Append-only event log
The system SHALL store every recorded play, marker, comment, edit and void as an immutable event with a client-generated unique id, a millisecond-precision timestamp, the game id, the typist and the unit (offense or defense) for plays. The system SHALL NOT overwrite or delete stored events.

#### Scenario: Idempotent submission
- **WHEN** the same event id is submitted twice
- **THEN** exactly one event exists afterwards

### Requirement: Effective state of events
The system SHALL derive the effective list of plays by applying the latest edit per event and excluding voided events; all consumers (score, ticker, export, extra-point detection) SHALL use this effective list.

#### Scenario: Voided play ignored
- **WHEN** a touchdown event is voided
- **THEN** it no longer contributes to the score and no longer triggers the extra-point phase

### Requirement: Lineup selection
The system SHALL let the typist choose the lineup of players on the field for offense and defense from the game roster, sorted by the applicable priority. A lineup of 1 to 9 players MUST be accepted; the system SHALL ask for explicit confirmation when the lineup does not contain exactly 5 players. An empty lineup MUST be rejected. The last lineup of a unit SHALL be pre-selected for the next play.

#### Scenario: Four players
- **WHEN** a typist saves a play with a lineup of 4 players
- **THEN** the system asks "Only 4 players on the field?" and saves only after confirmation

#### Scenario: Empty lineup
- **WHEN** a typist saves a play without any player in the lineup
- **THEN** the system rejects it and marks the lineup as required

#### Scenario: Carry-over
- **WHEN** a play has been saved with a given offense lineup
- **THEN** the next offense play starts with the same lineup selected

#### Scenario: Stale lineup member
- **WHEN** a carried-over lineup contains a player who is not on the game roster
- **THEN** that player is removed from the selection and the typist is informed

### Requirement: Offense quarterback and defense blitzers
The system SHALL require a quarterback for every offense play, chosen from the offense lineup and pre-selected from the previous play. The system SHALL allow zero or more blitzers on defense, chosen from the defense lineup; blitzers are optional.

#### Scenario: QB outside lineup
- **WHEN** the previous quarterback is no longer in the offense lineup
- **THEN** the quarterback selection is cleared and the offense play cannot be saved until a quarterback from the lineup is chosen

### Requirement: Offense play types and fields
The system SHALL offer the offense play types pass, run, sack, throwaway, dead_snap, foul_committed and foul_drawn, with pass as default, and SHALL show and require fields per type exactly as follows (R = required, O = optional, - = not shown):

| Type / path | Player | Pass result | Incomplete reason | Air yards | Yards after catch | Yards run | Flag pulls missed | Yards lost | Foul | Foul yards | Result options |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pass (no pass result yet) | R | R | - | - | - | - | - | - | - | - | none |
| pass, catch | R | R | - | R | O (default 0) | - | O (0-8, default 0, shown only if yards after catch is not 0) | - | - | - | td, first_down, tod |
| pass, incomplete | R | R | R | - | - | - | - | - | - | - | tod |
| pass, interception | R | R | - | - | - | - | - | - | - | - | pick_6 |
| run | R | - | - | - | - | R (default 0) | O (0-8, default 0, shown only if yards run is not 0) | - | - | - | td, first_down, tod |
| sack | - | - | - | - | - | - | - | R | - | - | tod, safety |
| throwaway | - | - | - | - | - | - | - | - | - | - | tod |
| dead_snap | - | - | - | - | - | - | - | - | - | - | tod |
| foul_committed | O | - | - | - | - | - | - | - | R | R if foul is other | tod |
| foul_drawn | O | - | - | - | - | - | - | - | R | R if foul is other | none |

Yard buckets for air yards, yards after catch and yards run SHALL be 0, 5, 10, 15, 20 and 30 (where 30 means "30+"). Yards lost SHALL be one of -5, 0, -10, -15. Foul yards SHALL be one of 0, -5, -10. The incomplete reasons SHALL be fifty_fifty, drop, uncatchable and batted. The pass results SHALL be catch, incomplete and interception. The foul options for offense foul_committed SHALL be illegal_contact, screening_bb, false_start, flag_guarding_jumping, unsporting and other; for offense foul_drawn they SHALL be illegal_contact, screening_bb, false_start, unsporting and other. The player of a play SHALL be chosen from the offense lineup.

#### Scenario: Catch requires air yards
- **WHEN** a typist selects pass, a player and the pass result catch but no air yards
- **THEN** saving is rejected and air yards is marked as required

#### Scenario: Flag pulls missed visibility
- **WHEN** a typist selects pass, catch and yards after catch 0
- **THEN** the flag pulls missed field is not shown
- **AND WHEN** yards after catch 5 is selected
- **THEN** the flag pulls missed field is shown with default 0

#### Scenario: Incomplete reason required
- **WHEN** a typist selects pass with pass result incomplete and no reason
- **THEN** saving is rejected and the incomplete reason is marked as required

#### Scenario: Sack needs yards lost only
- **WHEN** a typist selects sack and yards lost -5
- **THEN** the play can be saved without player or result

#### Scenario: Foul with other
- **WHEN** a typist selects foul_committed with foul other and no foul yards
- **THEN** saving is rejected and foul yards is marked as required

#### Scenario: Foul drawn has no result
- **WHEN** a typist selects foul_drawn on offense
- **THEN** no result field is shown

### Requirement: Defense play types and fields
The system SHALL offer the defense play types target, run, sack, throwaway, dead_snap, foul_committed and foul_drawn, with target as default, and SHALL show and require fields per type exactly as follows:

| Type / path | Player | Target result | Incomplete reason | Flag puller | Failed flag pull attempts | Foul | Foul yards | Result options |
|---|---|---|---|---|---|---|---|---|
| target (no target result yet) | R | R | - | O | O | - | - | none |
| target, catch_allowed | R | R | - | O | O (multiple) | - | - | td, first_down, tod |
| target, incomplete | R | R | R | - | - | - | - | tod |
| target, interception | R | R | - | - | - | - | - | pick_6 |
| run | - | - | - | O | O (multiple) | - | - | td, first_down, tod |
| sack | O | - | - | - | - | - | - | tod, safety |
| throwaway | O | - | - | - | - | - | - | tod |
| dead_snap | - | - | - | - | - | - | - | tod |
| foul_committed | O | - | - | - | - | R | R if foul is other | none |
| foul_drawn | O | - | - | - | - | R | R if foul is other | tod |

The target results SHALL be catch_allowed, incomplete and interception. The foul options for defense foul_committed SHALL be illegal_contact, screening_bb, illegal_blitz, unsporting and other; for defense foul_drawn they SHALL be illegal_contact, screening_bb, flag_guarding, unsporting and other. Player, flag puller and failed flag pull attempts SHALL be chosen from the defense lineup. Flag puller and failed attempts SHALL be hidden and cleared when the target result is incomplete or interception.

#### Scenario: Target requires player and result
- **WHEN** a typist selects target without target result
- **THEN** saving is rejected and player and target result are marked as required

#### Scenario: Interception hides puller fields
- **WHEN** a typist selects target and target result interception
- **THEN** flag puller and failed attempts are hidden and the only result option is pick_6

#### Scenario: Defense foul lists differ
- **WHEN** a typist selects foul_committed on defense
- **THEN** the option illegal_blitz is offered and false_start is not

### Requirement: Result is a warning outside the extra-point phase
Outside the extra-point phase the system SHALL NOT require a result; when a type offers result options and none is chosen, the system SHALL show a non-blocking warning before saving that a missing result is recorded as "no special result".

#### Scenario: Save without result
- **WHEN** a typist saves a catch without result and confirms the warning
- **THEN** the play is saved with no result

### Requirement: Extra-point phase
The system SHALL be in the extra-point phase when the latest effective play of the game has the result td, pick_6 or xp_retry. In that phase the normal result options SHALL be replaced by a single mandatory xp_result for every play type: offense options 1xp_made, 1xp_missed, 2xp_made, 2xp_missed, xp_retry; defense options 1xp_allowed, 1xp_prevented, 2xp_allowed, 2xp_prevented, xp_retry. All other field rules remain unchanged. The phase SHALL end with any saved xp_result other than xp_retry, and SHALL be derived from the event log, not from device-local state. The system SHALL show the heading "Extra point try" and SHALL hint which unit is expected: offense after a touchdown by the own team or a pick-6 by the own defense, defense after a touchdown by the opponent or a pick-6 against the own offense.

#### Scenario: Phase after touchdown
- **WHEN** a play with result td has been saved
- **THEN** the next play form shows "Extra point try" and requires an xp_result on every play type

#### Scenario: Retry keeps phase
- **WHEN** a play with xp_result xp_retry is saved
- **THEN** the next play is still in the extra-point phase

#### Scenario: Phase ends
- **WHEN** a play with xp_result 1xp_made is saved
- **THEN** the next play uses the normal result options

#### Scenario: Phase from another device
- **WHEN** the typist is handed over to another device after a touchdown
- **THEN** the new device is in the extra-point phase

#### Scenario: Unit mismatch hint
- **WHEN** the opponent has scored a touchdown and the typist opens the offense tab in the extra-point phase
- **THEN** the system hints that the defense is expected and still allows saving after confirmation

### Requirement: No hidden values
The system MUST NOT persist values of fields that are not visible for the chosen path. Changing the play type, the pass result or the target result SHALL clear all fields that become invisible. "Clear event" SHALL reset all play fields of the active unit including foul and foul yards to their defaults; offense and defense fields SHALL be independent.

#### Scenario: Switch type clears values
- **WHEN** a typist selects pass, catch, air yards 10, then switches to run and saves
- **THEN** the stored play contains no pass result and no air yards

#### Scenario: Foul reset
- **WHEN** a typist chose a foul and presses "Clear event"
- **THEN** the foul and foul yards are empty again

### Requirement: Fast saving flow
After saving a play the system SHALL reset the play fields, keep lineup, quarterback and blitzers, keep the selected unit, and show the saved play as the last event within one interaction.

#### Scenario: Next play
- **WHEN** a typist saves a play
- **THEN** the play form is empty, lineups are retained and the previous play is visible in the event list

### Requirement: Correction by edit, void and undo
The system SHALL allow typists to edit or void any play of their game and to undo the most recent play with one action. Edits and voids SHALL be new events referencing the original. Corrections SHALL be visible to ticker viewers as "corrected".

#### Scenario: Undo
- **WHEN** a typist presses undo after saving a play
- **THEN** a void event for that play is recorded and the play disappears from the effective list

#### Scenario: Edit a play
- **WHEN** a typist edits the player of an earlier play
- **THEN** an edit event is stored, the effective play shows the new player and the original event remains in the log

### Requirement: Comments
The system SHALL allow free-text comments linked to a game and optionally to a specific play. Saving an empty comment MUST be rejected.

#### Scenario: Comment on play
- **WHEN** a typist adds the comment "ToD vergessen" to a play
- **THEN** the comment is stored with timestamp, game and play reference

### Requirement: Previous event display
The system SHALL display the most recent effective event of the game as a short summary of type, player and result.

#### Scenario: Summary
- **WHEN** a pass to #96 with result first_down was saved
- **THEN** the summary reads "Pass, #96 Daniel Binder, first down"
