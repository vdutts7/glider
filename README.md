<div align="center">

<img src="assets/glider.webp" alt="glider" width="80" height="80" />
<img src="assets/crx.webp" alt="extension" width="80" height="80" />
<img src="assets/chrome.webp" alt="chrome" width="80" height="80" />

<h1 align="center">glider</h1>
<p align="center"><i><b>Chrome extension for browser automation via CDP.</b></i></p>

[![Chrome Web Store][cws]][cws-url]
[![GitHub][github]][github-url]

</div>

<br/>

## Table of Contents

<ol>
    <a href="#about">📝 About</a><br/>
    <a href="#install">💻 Install</a><br/>
    <a href="#usage">🚀 Usage</a><br/>
    <a href="#how-it-works">⚙️ How it Works</a><br/>
    <a href="#cli">🖥️ CLI</a><br/>
    <a href="#privacy">🔒 Privacy</a><br/>
    <a href="#contact">👤 Contact</a>
</ol>

<br/>

## 📝About

Bridge Chrome tabs to local development tools via Chrome DevTools Protocol (CDP).

- **CDP relay** - Connects browser to local WebSocket server
- **Tab control** - Attach/detach debugger to any tab
- **Auto-reconnect** - Survives relay restarts
- **Persistent** - Offscreen document keeps service worker alive

Designed to work with [glidercli](https://github.com/vdutts7/glidercli) for terminal-based browser automation.

## 💻Install

### Chrome Web Store (Recommended)
*Pending approval*

### Manual Install
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select this folder

## 🚀Usage

1. Install [glidercli](https://github.com/vdutts7/glidercli): `npm i -g glidercli`
2. Start relay: `glider install`
3. Click extension icon on any tab
4. Use CLI commands: `glider eval "document.title"`

### Extension Icon States
| Icon | Status |
|------|--------|
| 🔵 Blue | Connected to relay |
| ⚫ Gray | Disconnected |

## ⚙️How it Works

```
┌─────────────┐     WebSocket      ┌─────────────┐      CDP       ┌─────────────┐
│  glidercli  │ ◄──────────────► │   bserve    │ ◄────────────► │   Chrome    │
│   (CLI)     │    port 19988     │   (relay)   │   extension    │   (tabs)    │
└─────────────┘                   └─────────────┘                └─────────────┘
```

1. **bserve** runs as local WebSocket relay on port 19988
2. **Extension** connects to relay, attaches CDP debugger to tabs
3. **CLI** sends commands through relay to control browser

## 🖥️CLI

This extension is designed to work with [glidercli](https://github.com/vdutts7/glidercli):

```bash
npm i -g glidercli
glider install    # start daemon
glider connect    # connect to browser
glider goto "https://example.com"
glider eval "document.title"
glider screenshot /tmp/page.png
```

See [glidercli README](https://github.com/vdutts7/glidercli) for full documentation.

## 🔒Privacy

- **No data collection** - Extension only communicates with localhost
- **No external servers** - All traffic stays on your machine
- **No tracking** - Zero analytics or telemetry
- **Open source** - Full code visibility

See [PRIVACY.md](PRIVACY.md) for details.

## 👤Contact

[![Email][email]][email-url]
[![Twitter][twitter]][twitter-url]

## License

MIT

<!-- BADGES -->
[cws]: https://img.shields.io/badge/Chrome_Web_Store-pending-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white
[cws-url]: #
[github]: https://img.shields.io/badge/GitHub-glider-181717?style=for-the-badge&logo=github&logoColor=white
[github-url]: https://github.com/vdutts7/glider
[email]: https://img.shields.io/badge/Email-000000?style=for-the-badge&logo=Gmail&logoColor=white
[email-url]: mailto:me@vd7.io
[twitter]: https://img.shields.io/badge/Twitter-000000?style=for-the-badge&logo=Twitter&logoColor=white
[twitter-url]: https://x.com/vdutts7
