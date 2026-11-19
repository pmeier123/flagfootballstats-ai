## Purpose

Give spectators a public, read-only live view of a game that shows every recorded detail in readable sentences, with highlights, filters and running statistics.

## ADDED Requirements

### Requirement: Public access by token
The system SHALL serve the ticker of a game to anyone holding the game's ticker token without login, and SHALL expose no other game data. The ticker page SHALL ask search engines not to index it.

#### Scenario: Valid token
- **WHEN** a visitor opens the ticker link of a game
- **THEN** the ticker of exactly that game is shown without login

#### Scenario: Invalid token
- **WHEN** a visitor opens a link with an unknown token
- **THEN** no game data is shown

### Requirement: Header
The ticker SHALL show both team names, the current score, the quarter or halftime, the game status and the time since the last update.

#### Scenario: Header content
- **WHEN** the game is live in quarter 2 with score 14 : 7
- **THEN** the header shows both teams, "14 : 7", "Q2", status live and a last-update time

### Requirement: Feed with readable sentences
The ticker SHALL list effective plays newest first, grouped by drive with quarter dividers, each as a readable German sentence containing every recorded field: type, player (number and name), quarterback, pass result, incomplete reason, air yards, yards after catch, yards run, flag pulls missed, yards lost, foul and foul yards, result, extra-point result, flag puller and failed attempts, and the time. The lineup on the field and the blitzers SHALL be available by expanding the entry.

#### Scenario: Catch sentence
- **WHEN** a catch to #96 Daniel Binder from QB #54 Oskar Küsgen with 15 air yards, 15 yards after catch, one missed flag pull and result first down is recorded
- **THEN** the entry names the receiver, the quarterback, both yard values, the missed flag pull and "First Down"

#### Scenario: Expand
- **WHEN** a visitor expands an entry
- **THEN** the lineup and blitzers of that play are shown

### Requirement: Highlights
The ticker SHALL visually emphasize touchdowns, pick-6, interceptions, sacks, safeties, extra points and fouls with an icon and colour, and SHALL distinguish offense and defense by colour.

#### Scenario: Touchdown highlight
- **WHEN** a touchdown play appears in the feed
- **THEN** it is shown with a touchdown icon and emphasized styling

### Requirement: Visible corrections
The ticker SHALL mark edited plays as "corrected" and SHALL remove voided plays from the feed while keeping the score consistent.

#### Scenario: Corrected entry
- **WHEN** a play is edited
- **THEN** its entry shows the new content and a "corrected" marker

### Requirement: Live statistics
The ticker SHALL show running game statistics computed from effective plays: pass completion rate, air yards and yards after catch, sacks, interceptions, fouls, and top players per category.

#### Scenario: Completion rate
- **WHEN** 6 passes with pass result catch and 4 with result incomplete or interception are recorded
- **THEN** the completion rate shows 60 %

### Requirement: Filters
The ticker SHALL allow filtering by offense, defense, scoring plays only, highlights only and by player, without reloading the page.

#### Scenario: Scoring only
- **WHEN** a visitor selects "scoring plays only"
- **THEN** only plays that produce points are listed

### Requirement: Automatic updates
The ticker SHALL update automatically without page reload, within 10 seconds of an event being confirmed by the backend, SHALL request only events newer than those already shown, and SHALL keep the scroll position stable while new entries arrive. When the connection fails it SHALL show that the data may be outdated and retry automatically.

#### Scenario: New play arrives
- **WHEN** a new play is recorded while a visitor reads older entries
- **THEN** the new entry appears at the top and the visitor's scroll position does not jump

### Requirement: Mobile-first and themes
The ticker SHALL be usable on narrow phone screens and SHALL support light and dark appearance.

#### Scenario: Phone width
- **WHEN** the ticker is opened at 360 px width
- **THEN** all content is readable without horizontal scrolling

### Requirement: Local preview
The system SHALL allow the typist to open the same ticker view for the local game state, including without a backend.

#### Scenario: Preview offline
- **WHEN** the typist opens the preview without connectivity
- **THEN** the ticker shows the plays recorded on the device
