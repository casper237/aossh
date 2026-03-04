# Changelog

## [1.0.3] - 2026-03-04
### Fixed
- Titlebar drag zone now starts right after the last tab

## [1.0.2] - 2026-03-04
### Added
- Export / Import connections (Tools menu ⚙)
- Toast notifications for export/import actions

### Fixed
- Invisible drag zone in titlebar when tabs are open

## [1.0.1] - 2026-03-04
### Added
- 2-level group hierarchy (groups + subgroups)
- Right-click context menu on connections (Connect / Edit / Move / Delete)
- Right-click context menu on groups (Add subgroup / Rename / Delete)
- Move connection to another group/subgroup via submenu
- Clipboard paste in terminal — Ctrl+V and right-click
- Welcome screen with usage manual
- Custom confirm/input modals (no system dialogs)
- App icon (blue background + orange lightning bolt)
- Windows Server / virtual machine compatibility (disable-gpu)

### Changed
- Double-click to connect (single click only selects)
- Edit connection only via right-click menu
- All statuses reset to offline on app startup
- Removed theme switcher button

### Fixed
- Group dropdown in connection modal
- Input fields not working in modals
- Terminal bottom padding (last line no longer clipped)

## [1.0.0] - 2026-03-03
### Added
- SSH terminal with xterm.js
- SFTP file manager (browse, upload, download, delete)
- Connection manager with groups
- Collapsible groups in sidebar
- Password and SSH key authentication
- Multiple tabs support
- Custom titlebar (minimize, maximize, close)
- Search connections
- Connection status indicator (online/offline)
- Dark theme
