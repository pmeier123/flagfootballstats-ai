## Purpose

Maintain the team's player master data and the per-game roster so that selection lists in event capture only offer valid, ordered players.

## ADDED Requirements

### Requirement: Player master data
The system SHALL store for each player a stable id, a jersey number as text (e.g. "2V"), a name, an active flag and four priorities (offense, defense, qb, blitz) each between 1 and 9, where 1 is the highest priority and 9 means "not intended".

#### Scenario: Create player
- **WHEN** an admin creates a player with number "97", name "Yunus Ulrich" and valid priorities
- **THEN** the player is stored and appears in the roster list

#### Scenario: Reject invalid priority
- **WHEN** an admin saves a player with a priority of 0 or 10
- **THEN** the system rejects the input and names the invalid field

### Requirement: Unique jersey number among active players
The system MUST reject saving an active player whose jersey number equals that of another active player.

#### Scenario: Duplicate number
- **WHEN** an active player with number "97" exists and an admin activates or creates a second active player with number "97"
- **THEN** the system rejects the change and reports the conflicting player

### Requirement: Deactivate instead of delete
The system SHALL allow deactivating a player and SHALL NOT delete a player who is referenced by any event; deactivated players remain visible in historical data but are not offered in new selection lists.

#### Scenario: Deactivate referenced player
- **WHEN** an admin deactivates a player who appears in recorded events
- **THEN** past events still show the player and new selection lists exclude the player

#### Scenario: Delete referenced player blocked
- **WHEN** an admin tries to delete a player referenced by events
- **THEN** the system refuses and offers deactivation

### Requirement: Bulk operations
The system SHALL support selecting multiple players to deactivate them at once, and importing players from a CSV file with columns number, name and optional offense_order, defense_order, qb_order, blitz_order.

#### Scenario: CSV import with errors
- **WHEN** an admin imports a CSV with one row lacking a name and one row with a duplicate number
- **THEN** valid rows are listed for confirmation, invalid rows are reported with row number and reason, and nothing is saved until the admin confirms

### Requirement: Priority-based ordering of selection lists
The system SHALL sort offense lineup, defense lineup, QB and blitzer selection lists ascending by the respective priority, ties broken by jersey number, and the remaining player lists by jersey number.

#### Scenario: QB list order
- **WHEN** the QB list is shown for a lineup of five players with qb priorities 9, 1, 2, 9, 9
- **THEN** the player with priority 1 is first, then priority 2, then the rest by number

### Requirement: Game roster
The system SHALL maintain a per-game roster of players present; selection lists during capture SHALL only contain players from the game roster.

#### Scenario: Player not on roster
- **WHEN** a player is not on the game roster
- **THEN** the player is not offered in any capture selection list of that game
