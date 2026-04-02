### ADDED Requirement: Devices row copy action
The Devices page SHALL provide a copy action for each saved device row so operators can copy the device name and IP address together.

#### Scenario: Copy device details from row
- **WHEN** a user clicks the row copy action for a saved device
- **THEN** the frontend writes `<deviceName>\t<ipAddress>` to the clipboard
- **AND** the row delete action remains available in the same row
