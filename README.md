# AOSSH

A SSH & SFTP client built with Electron. Tested on Windows.

## Features

- **SSH Terminal** — interactive shell with xterm.js
- **SFTP File Manager** — browse, upload, download and delete files
- **Connection Manager** — organize servers with groups and subgroups
- **Context Menu** — connect, edit, move, delete via right-click
- **Clipboard Support** — Ctrl+V and right-click paste in terminal
- **Export / Import** — backup and restore your connections
- **Multi-tab** — connect to multiple servers at once

## Getting Started

### Requirements

- [Node.js](https://nodejs.org/) v18+
- npm

### Install & Run

```bash
npm install
npm start
```

### Build

```bash
npm run build
```

Installer will be created in the `dist/` folder.

## Usage

| Action | Result |
|--------|--------|
| Single click on server | Select |
| Double click on server | Connect |
| Right click on server | Context menu (Connect / Edit / Move / Delete) |
| Right click on group | Add subgroup / Rename / Delete |
| Ctrl+V in terminal | Paste from clipboard |
| Right click in terminal | Paste from clipboard |

## License

MIT
