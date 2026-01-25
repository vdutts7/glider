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

## ToC

<ol>
    <a href="#about">About</a><br/>
    <a href="#install">Install</a><br/>
    <a href="#usage">Usage</a><br/>
    <a href="#how-it-works">⚙️ How it Works</a><br/>
    <a href="#cli">CLI</a><br/>
    <a href="#privacy">Privacy</a><br/>
    <a href="#contact">Contact</a>
</ol>

<br/>

## About

Bridge Chrome tabs to local dev tools via Chrome DevTools Protocol (CDP).

- **CDP relay** - Connects browser to local WebSocket server
- **Tab control** - Attach/detach debugger to any tab
- **Auto-reconnect** - Survives relay restarts
- **Persistent** - Offscreen document keeps service worker alive

Designed to work with [glidercli](https://github.com/vdutts7/glidercli) for **terminal-based browser automation**

## Install

### Chrome Web Store (recommended)
[Get Glider Chrome extension here for free](https://chromewebstore.google.com/detail/glider/njbidokkffhgpofcejgcfcgcinmeoalj?hl=en-US)

### Manual install
1. Clone this repo
2. Go to `chrome://extensions` > Enable "Developer mode" > Click "Load unpacked"
5. Select this folder

## Usage

1. Install [glidercli](https://github.com/vdutts7/glidercli): `npm i -g glidercli`
2. Start relay: `glider install`
3. Click extension icon (any tab)
4. Use CLI commands: `glider eval "document.title"`

### Extension icon states
| Icon | Status |
|------|--------|
| 🔵 Blue | Connected to relay |
| ⚫ Gray | Disconnected |

## ⚙️How it works

```
┌─────────────┐     WebSocket      ┌─────────────┐      CDP       ┌─────────────┐
│  glidercli  │ ◄──────────────► │   bserve    │ ◄────────────► │   Chrome    │
│   (CLI)     │    port 19988     │   (relay)   │   extension    │   (tabs)    │
└─────────────┘                   └─────────────┘                └─────────────┘
```

1. **bserve** runs as local WebSocket relay on port 19988
2. **Extension** connects to relay, attaches CDP debugger to tabs
3. **CLI** sends commands through relay to control browser

## CLI

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

## Privacy

- **No data collection** - Extension only communicates with localhost
- **No external servers** - All traffic stays on your machine
- **No tracking** - Zero analytics or telemetry
- **Open source** - Full code visibility

See [PRIVACY.md](PRIVACY.md) for details.

## Contact


<a href="https://vd7.io"><img src="https://img.shields.io/badge/website-000000?style=for-the-badge&logo=data:image/webp;base64,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&logoColor=white" alt="website" /></a>
<a href="https://x.com/vdutts7"><img src="https://img.shields.io/badge/vdutts7-000000?style=for-the-badge&logo=X&logoColor=white" alt="Twitter" /></a>


## License

MIT

<!-- BADGES -->
[cws]: https://img.shields.io/badge/Chrome_Web_Store-pending-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white
[cws-url]: https://chromewebstore.google.com/detail/glider/njbidokkffhgpofcejgcfcgcinmeoalj?hl=en-US
[github]: https://img.shields.io/badge/GitHub-glider-181717?style=for-the-badge&logo=github&logoColor=white
[github-url]: https://github.com/vdutts7/glider
[email]: https://img.shields.io/badge/Email-000000?style=for-the-badge&logo=Gmail&logoColor=white
[email-url]: mailto:me@vd7.io
[twitter]: https://img.shields.io/badge/Twitter-000000?style=for-the-badge&logo=Twitter&logoColor=white
[twitter-url]: https://x.com/vdutts7
