## Purpose

Compute the game score and the list of scoring events deterministically from the effective events so that the live score, ticker, export and reports always agree.

## ADDED Requirements

### Requirement: Scoring rules
The system SHALL derive points exclusively from the effective plays of a game according to this table, where "own" is the Aachen Emperors and "opp" the opponent:

| Unit | Result | Points |
|---|---|---|
| offense | td | own +6 |
| offense | pick_6 | opp +6 |
| offense | safety | opp +2 |
| offense | 1xp_made | own +1 |
| offense | 2xp_made | own +2 |
| defense | td | opp +6 |
| defense | pick_6 | own +6 |
| defense | safety | own +2 |
| defense | 1xp_allowed | opp +1 |
| defense | 2xp_allowed | opp +2 |

All other results (first_down, tod, 1xp_missed, 2xp_missed, 1xp_prevented, 2xp_prevented, xp_retry, no result) and all fouls SHALL yield no points.

#### Scenario: Own offense touchdown and extra point
- **WHEN** an offense play with result td and a following offense play with xp_result 1xp_made exist
- **THEN** the score is own 7, opp 0

#### Scenario: Opponent touchdown on defense
- **WHEN** a defense play with result td and a following defense play with xp_result 2xp_allowed exist
- **THEN** the score is own 0, opp 8

#### Scenario: Pick-6 both directions
- **WHEN** a defense play with result pick_6 and an offense play with result pick_6 exist
- **THEN** own receives 6 and opp receives 6

#### Scenario: Safety
- **WHEN** an offense sack with result safety exists
- **THEN** opp receives 2 points
- **AND WHEN** a defense sack with result safety exists
- **THEN** own receives 2 points

#### Scenario: Missed extra point
- **WHEN** an offense play with xp_result 1xp_missed exists
- **THEN** no points are added

### Requirement: Scoring events
The system SHALL expose each scoring play as a scoring event with event id, timestamp, unit, scoring team (own or opp), points and a reason, ordered by time.

#### Scenario: Scoring event list
- **WHEN** the score is computed for a game with two scoring plays
- **THEN** exactly two scoring events are returned in chronological order, each with scoring team and points

### Requirement: Effective events only
The score SHALL be computed only from effective events; voided events SHALL NOT score, and edited events SHALL score according to their latest version.

#### Scenario: Edit changes score
- **WHEN** a play with result td is edited to result first_down
- **THEN** the six points are removed from the score

### Requirement: Determinism and shared implementation
The same inputs MUST always produce the same score, and the device, the backend and the export SHALL use the same rule set.

#### Scenario: Order independence of input
- **WHEN** the same effective events are supplied in a different input order
- **THEN** the resulting score is identical
