## Purpose

Control who can administer data, record events and view games, using passwordless login and server-enforced access rules.

## ADDED Requirements

### Requirement: Roles
The system SHALL support the roles admin, typist and viewer. Admins manage roster, teams, games, typists, game completion and corrections after completion. Typists record and correct events only for games where they are the active typist. Viewers and anonymous visitors can only read the ticker.

#### Scenario: Typist cannot edit roster
- **WHEN** a typist tries to change a player
- **THEN** the backend rejects the request

### Requirement: Passwordless login
The system SHALL authenticate users by emailed one-time login link and SHALL NOT store passwords.

#### Scenario: Login link
- **WHEN** a known user requests a login link
- **THEN** an email with a one-time link is sent and following it creates a session

### Requirement: Server-side enforcement
Access rules SHALL be enforced by the backend; client-side hiding of controls MUST NOT be the only protection.

#### Scenario: Direct API write
- **WHEN** a non-assigned user writes an event directly to the backend API
- **THEN** the write is rejected

### Requirement: Finished games locked for typists
The system SHALL reject event writes of typists for finished games, while admins MAY still correct them, and each admin correction SHALL be a visible edit or void event.

#### Scenario: Admin correction
- **WHEN** an admin voids a play in a finished game
- **THEN** a void event with the admin as author is stored

### Requirement: Public ticker boundary
Anonymous access SHALL be limited to read-only ticker data of games addressed by a valid token; roster contact data, user data and other games MUST NOT be reachable.

#### Scenario: Enumerate games
- **WHEN** an anonymous client requests the list of games
- **THEN** the backend returns nothing
