# AOSSH

A SSH & SFTP client built with Electron. Tested on Windows.

## Features

- **SSH Terminal** — interactive shell (xterm.js) with auto-reconnect on connection drop
- **SFTP File Manager** — browse, upload, download, edit, rename and delete files; drag & drop upload
- **Connection Manager** — organize servers with groups and subgroups; import from MobaXterm
- **AI Assistant Panel** — built-in tabs for ChatGPT, Claude, Gemini, Grok, Perplexity (bring your own account)
- **Context Menu** — connect, edit, move, delete via right-click
- **Clipboard Support** — Ctrl+V and right-click paste in terminal
- **Multi-tab** — connect to multiple servers at once
- **Export / Import** — back up and restore connections, optionally passphrase-encrypted

## Security

- **Host key verification** — the server's key is pinned on first connect; connections are refused if a known host later presents a different key (man-in-the-middle protection)
- **Encrypted credential storage** — saved passwords are encrypted at rest via Windows DPAPI, never stored in plaintext
- **Optional master password** — encrypt saved passwords with a passphrase (scrypt + AES-256-GCM), required at startup and stored nowhere. Enable it in **⚙️ → Security → Master password**
- **Encrypted export** — connection exports can be protected with a passphrase for safe transfer between machines

## Installation

Download the latest installer from [Releases](https://github.com/casper237/aossh/releases).

> **Windows SmartScreen warning:** When running the installer you may see "Windows protected your PC". This happens because the app is not yet code-signed. Click **More info** → **Run anyway** to proceed.

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
