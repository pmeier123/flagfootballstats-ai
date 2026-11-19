## Purpose

Manage opponents, games and their lifecycle so that every recorded event belongs to exactly one identifiable game with date, occasion and responsible typist.

## ADDED Requirements

### Requirement: Teams as master data
The system SHALL store opponents as reusable teams with a unique name; games SHALL reference a team by id, not by free text.

#### Scenario: Reuse opponent
- **WHEN** an admin creates a second game against an existing opponent
- **THEN** the existing team is selected and no duplicate team is created

### Requirement: Game definition
The system SHALL store for each game an id, opponent team, date, occasion (dffl_game, semifinal, final, group_stage, other), optional venue and a status of planned, live or finished. Opponent, date and occasion are mandatory.

#### Scenario: Missing mandatory field
- **WHEN** an admin saves a game without opponent, date or occasion
- **THEN** the system rejects the input and marks each missing field as required

### Requirement: Game status lifecycle
The system SHALL only allow the transitions planned to live, live to finished and, by an admin, finished back to live. Events SHALL only be accepted from typists while the game is live.

#### Scenario: Event on finished game
- **WHEN** a typist submits an event for a finished game
- **THEN** the event is rejected with a message that the game is finished

#### Scenario: Reopen game
- **WHEN** an admin reopens a finished game
- **THEN** the status becomes live and typists can record again

### Requirement: Typist assignment with handover
The system SHALL have at most one active typist per game and SHALL allow an admin or the active typist to hand over to another user; each assignment records start and end time.

#### Scenario: Handover
- **WHEN** the active typist hands the game to another user
- **THEN** the previous assignment ends, the new one starts, and events from the previous typist stay attributed to them

#### Scenario: Non-assigned typist
- **WHEN** a user who is not the active typist submits an event
- **THEN** the system rejects the event

### Requirement: Markers
The system SHALL support markers recorded as events: quarter start, quarter end, halftime, drive end, timeout and game end. The current quarter SHALL be derived from the markers.

#### Scenario: Derive quarter
- **WHEN** one quarter-end marker and one quarter-start marker have been recorded
- **THEN** subsequent events belong to quarter 2

### Requirement: Ticker link
The system SHALL generate a random, unguessable ticker token per game and SHALL expose a copyable link and QR code to admins. Regenerating the token SHALL invalidate the old link.

#### Scenario: Regenerate token
- **WHEN** an admin regenerates the ticker token
- **THEN** the old link no longer shows the game and the new link does

### Requirement: Finish game check
The system SHALL, when finishing a game, report open warnings (events without result, unsynced events, missing game-end marker) and require explicit admin confirmation.

#### Scenario: Unsynced events
- **WHEN** an admin finishes a game while events on the typist device are not yet confirmed by the backend
- **THEN** the system shows the number of open events and requires confirmation
