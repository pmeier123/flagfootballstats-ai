## Purpose

Migrate the historical offense, defense and comment data of the old Stats V2 app into the new model without losing information and without inventing facts.

## ADDED Requirements

### Requirement: Import of legacy rows
The system SHALL import offense, defense and comment rows from CSV or JSON exports of the old Google Sheets into games, plays and comments, mapping the literal "default" to an empty value, numeric strings to numbers, and old values to the new enumerations.

#### Scenario: Default mapping
- **WHEN** a legacy offense row contains "default" for the incomplete reason
- **THEN** the imported play has no incomplete reason

#### Scenario: Value mapping
- **WHEN** a legacy row has result "Touchdown", target result "Catch allowed" and eventtype "Foul committed"
- **THEN** the imported play has result td, target result catch_allowed and type foul_committed

### Requirement: Games from opponent and occasion
The import SHALL create one game per distinct combination of legacy opponent name and occasion, link plays to it by id, and map legacy opponent names to teams, reusing existing teams by exact name.

#### Scenario: Two opponents
- **WHEN** legacy data contains rows for "Sassenberg Knights" and "Semi final"
- **THEN** two games are created and each play belongs to exactly one of them

### Requirement: Chronological order and timestamps
The import SHALL parse the legacy timestamp format "dd.MM.yyyy, HH:mm" as Europe/Berlin local time, and SHALL order plays within the same minute by their original row order, assigning increasing millisecond offsets.

#### Scenario: Same minute
- **WHEN** three legacy rows share the timestamp "19.09.2026, 13:35"
- **THEN** the imported plays keep their original row order

### Requirement: Player and lineup mapping
The import SHALL map jersey numbers and "number name" labels to players, parse lineup lists given as comma-separated numbers into lineup members, and report every number or name that matches no player or several players as an unresolved reference without guessing.

#### Scenario: Unknown number
- **WHEN** a legacy lineup contains the number "17" and no player has that number
- **THEN** the import report lists "17" as unresolved and the import requires a mapping decision

### Requirement: Dry run and report
The import SHALL provide a dry run that changes nothing and reports counts per target, ambiguous or unmappable values and rows that would be skipped, and the real import SHALL only run after the report was confirmed.

#### Scenario: Dry run
- **WHEN** an admin starts a dry run
- **THEN** no data is stored and a report with counts and issues is shown

### Requirement: Repeatable import
Re-running the import with the same source MUST NOT create duplicate games, plays or comments.

#### Scenario: Second run
- **WHEN** the same legacy export is imported twice
- **THEN** the number of games, plays and comments is the same as after the first run

### Requirement: Legacy score cross-check
The import report SHALL show the score computed by the new scoring rules per game next to the data needed to compare it with the legacy score.

#### Scenario: Score shown
- **WHEN** the dry run finishes
- **THEN** the report lists the new-rule score per imported game
