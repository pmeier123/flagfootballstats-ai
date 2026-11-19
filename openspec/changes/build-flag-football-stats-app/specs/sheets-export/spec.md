## Purpose

Deliver the effective event data to Google Sheets in flat, typed tables so Looker Studio can build reports, without requiring the typist's browser and without exceeding Google API limits.

## ADDED Requirements

### Requirement: Server-side export independent of the browser
The system SHALL export confirmed events to Google Sheets from the backend on a schedule (every minute while a game is live, otherwise at a lower frequency) and at game end, without requiring any client to be open.

#### Scenario: Browser closed
- **WHEN** the typist closes the browser after all events were confirmed
- **THEN** the export still delivers all events to the sheet

### Requirement: Idempotent export with progress
The export SHALL record the last exported sequence per game and target, SHALL write each event identified by its event id exactly once and MUST NOT create duplicate rows on retries.

#### Scenario: Retry after failure
- **WHEN** an export run fails after writing part of a batch and runs again
- **THEN** no event appears twice in the sheet

### Requirement: Corrections propagate
The export SHALL reflect edits by updating the existing row of the event and SHALL mark voided events with voided=true instead of deleting the row. Derived tables (lineups, scores) SHALL be recomputed for the affected events.

#### Scenario: Edited play
- **WHEN** an exported play is edited
- **THEN** the same row contains the new values after the next run

#### Scenario: Voided play
- **WHEN** an exported play is voided
- **THEN** its row is marked voided and its score rows are removed

### Requirement: Flat typed tables
The export SHALL write these tabs: plays (one row per play with all fields as typed values, readable names and ids, quarter, drive number, typist, voided flag), lineups (one row per player on the field per play), scores (one row per scoring event with scoring team, points and reason), games, players and comments. Empty values SHALL be empty cells and numbers SHALL be numeric cells.

#### Scenario: Lineup rows
- **WHEN** a play with five players on the field is exported
- **THEN** five rows referencing the play id exist in the lineups tab

#### Scenario: Typed values
- **WHEN** a catch with 15 air yards is exported
- **THEN** the air yards cell holds the number 15 and unrelated cells are empty

### Requirement: Respect API limits
The export SHALL write in batches, SHALL stay below the Google Sheets write quota and SHALL back off on quota errors.

#### Scenario: Large backlog
- **WHEN** 500 events are pending
- **THEN** they are written in batches over multiple requests without quota errors

### Requirement: Export status
The system SHALL show admins the time of the last successful export, the last exported sequence and the last error per game.

#### Scenario: Export error
- **WHEN** the export fails because the sheet is not shared with the service account
- **THEN** the admin view shows the error and the events remain queued

### Requirement: Credentials stay server-side
Google credentials MUST NOT be present in any client code or client-reachable response.

#### Scenario: Client bundle
- **WHEN** the client bundle is inspected
- **THEN** it contains no Google credentials

### Requirement: Manual export
The system SHALL let admins download a game or season as CSV and JSON from the application regardless of the sheet export.

#### Scenario: CSV download
- **WHEN** an admin downloads the plays of a game as CSV
- **THEN** the file contains one row per effective play with the same columns as the plays tab
