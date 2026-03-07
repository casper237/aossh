# Changelog

## [1.3.3] - 2026-03-07
### Added
- AI browser panel with built-in tabs (ChatGPT, Claude, Gemini, Grok, DeepSeek)
- Cancel upload button (✕) in SFTP status bar
- Remember expanded/collapsed state of groups and subgroups between sessions

### Fixed
- SFTP upload failure (SSH_FX_FAILURE): smart concurrency fallback — tries max speed (64 concurrent) first, retries at lower concurrency on server error
- SFTP folder delete from context menu now works (recursive rm)

## [1.3.2] - 2026-03-07
### Fixed
- Ctrl+V double paste on virtual machines, restored paste for non-Latin keyboard layouts
- Terminal bottom padding: last line no longer hidden behind border
- Slow startup: bundle xterm.js locally, defer update check
- Black screen on virtual machines and Windows Server (GPU fallback)

## [1.3.0] - 2026-03-06
### Added
- Drag & drop file upload into SFTP panel
- Right-click context menu on files/folders (download, edit, rename, delete)
- Edit text files inline with built-in editor
- Download folder recursively
- Multiple file upload via dialog

### Fixed
- Reuse SFTP channel per session (fixes "Channel open failure")
- Auto-retry SFTP operations on stale channel (fixes periodic errors)
- New folder dialog uses custom modal instead of browser prompt

## [1.2.1] - 2026-03-06
### Added
- App version shown on welcome screen

### Fixed
- Emoji rendering in context menus (pencil, trash icons)
- Removed MobaXterm import (passwords not exported by MobaXterm)

## [1.2.0] - 2026-03-06
### Added
- Update check on startup: if a newer version is available on GitHub, a modal prompts to download it

## [1.1.0] - 2026-03-05
### Added
- Import connections from MobaXterm (.mxtsessions)
- Tools menu ⚙ in titlebar (Export / Import)
- Invisible drag zone in titlebar when tabs are open

### Fixed
- Tools menu text wrapping
- Tools menu icon alignment

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
