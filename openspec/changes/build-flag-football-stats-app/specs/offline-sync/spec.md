## Purpose

Guarantee that recorded events survive poor connectivity and browser closure, are delivered to the backend exactly once, and that the typist always knows whether the browser must stay open.

## ADDED Requirements

### Requirement: Local-first recording
The system SHALL store every new event on the device before any network call and SHALL allow recording to continue without a network connection.

#### Scenario: Offline recording
- **WHEN** the device has no connectivity and the typist saves three plays
- **THEN** all three plays are stored locally, appear in the event list and count towards the live score

### Requirement: Idempotent delivery with acknowledgement
The system SHALL send locally stored events to the backend in batches and SHALL mark an event as confirmed only after the backend acknowledged its id. Re-sending an event MUST NOT create a duplicate. The backend SHALL assign a monotonically increasing sequence number per game.

#### Scenario: Retry after lost response
- **WHEN** a batch reaches the backend but the acknowledgement is lost and the device resends the batch
- **THEN** the backend stores each event once and acknowledges all of them

### Requirement: Retry with backoff
The system SHALL retry failed deliveries automatically with increasing delay and SHALL attempt delivery immediately when connectivity returns and when the page becomes hidden or is being closed.

#### Scenario: Connectivity returns
- **WHEN** connectivity returns while events are pending
- **THEN** delivery starts without user action

### Requirement: Sync status display
The system SHALL permanently display one of these states in the capture view: synced ("saved, browser may be closed"), sending (count of events being sent, browser must stay open), offline (count of events only on this device, browser must stay open), error (cause and retry action, browser must stay open) and sheets_pending (events saved on the server, Google Sheets will follow, browser may be closed). The display SHALL show "browser may be closed" only when no event is unconfirmed.

#### Scenario: Pending events
- **WHEN** at least one event is unconfirmed
- **THEN** the status shows sending or offline and states that the browser must stay open

#### Scenario: All confirmed
- **WHEN** all local events are confirmed by the backend
- **THEN** the status shows that the browser may be closed

### Requirement: Leave warning
The system SHALL warn the user when leaving or closing the page while unconfirmed events exist.

#### Scenario: Close tab
- **WHEN** the user closes the tab with two unconfirmed events
- **THEN** the browser shows a confirmation prompt

### Requirement: Durable local storage
The system SHALL request persistent storage from the browser and SHALL keep the screen awake during a live game where the browser supports it.

#### Scenario: Storage permission
- **WHEN** the capture view opens for a live game
- **THEN** the system requests persistent storage

### Requirement: Final confirmation
When a game ends, the system SHALL show either "all events saved" or the number of events still open with the instruction to stay online.

#### Scenario: Open events at game end
- **WHEN** the game-end marker is recorded with four unconfirmed events
- **THEN** the system shows "4 events still open - please stay online"

### Requirement: Works without backend
The system SHALL remain fully usable for capture, score and local export when no backend is configured; in that case the status SHALL state that events are stored only on this device.

#### Scenario: No backend configured
- **WHEN** no backend is configured
- **THEN** capture works and the status reads that events exist only on this device
