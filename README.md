<div align="center">

<img src="https://raw.githubusercontent.com/vdutts7/squircle/refs/heads/main/webp/glider.webp" alt="glider" width="80" height="80" />
<img src="https://raw.githubusercontent.com/vdutts7/squircle/refs/heads/main/webp/crx.webp" alt="extension" width="80" height="80" />
<img src="https://raw.githubusercontent.com/vdutts7/squircle/refs/heads/main/webp/chrome.webp" alt="chrome" width="80" height="80" />

<h1 align="center">glider</h1>
<p align="center"><i><b>Chromium-based extension for CLI-powered browser automation</b></i></p>

[![Chrome Web Store][cws]][cws-url]
[![GitHub][github]][github-url]

</div>

<br/>

## ToC

<ol>
    <a href="#about">About</a><br/>
    <a href="#browsers">Browsers</a><br/>
    <a href="#install">Install</a><br/>
    <a href="#usage">Usage</a><br/>
    <a href="#how-it-works">How it works</a><br/>
    <a href="#cli">CLI</a><br/>
    <a href="#privacy">Privacy</a><br/>
    <a href="#contact">Contact</a>
</ol>

<br/>

## About

- bridge Chrome tabs to local dev tools through **Chrome DevTools Protocol (CDP)**
- **CDP relay**: connects browser to a local WebSocket server
- **tab control**: attaches + detaches debugger from any tab
- **auto reconnect**: survives local relay restarts
- **persistent runtime**: offscreen document keeps service worker alive

- built for [glidercli](https://github.com/vdutts7/glidercli) and **CLI-based browser automation**

## Browsers

- chromium-based only (no Firefox/Safari/DuckDuckGo) because Glider uses a **Chrome Web Store extension** + CDP
- default: **Google Chrome** for `glider connect`
- supported: Arc, Microsoft Edge, Brave, Opera, Vivaldi
  (extension must be installed + enabled in that same browser profile)
- other Chromium: must support installing extensions from Chrome Web Store
- choose browser via `GLIDER_BROWSER`
    - > ex: `export GLIDER_BROWSER=Arc` then → `glider connect`
- optional: `GLIDER_BROWSER_PATH` for non-default app bundle locations
- full browser registry options → [glidercli docs/BROWSERS.md](https://github.com/vdutts7/glidercli/blob/main/docs/BROWSERS.md)

## Install

- install from [Chrome Web Store](https://chromewebstore.google.com/detail/glider/njbidokkffhgpofcejgcfcgcinmeoalj?hl=en-US)


## Usage

- install [glidercli](https://github.com/vdutts7/glidercli): `npm i -g glidercli`
- start relay: `glider install`
- click extension icon in the target browser you want to automate
- run a CLI command: `glider eval "document.title"`

### Extension icon states
| Icon | Status |
|------|--------|
| 🟢 | Connected to relay |
| 🔴 | Disconnected |

## How it works

![Glider architecture diagram](https://res.cloudinary.com/ddyc1es5v/image/upload/v1774255955/vd7-website/glider-architecture-diagram.png)

> source: [`docs/glider-architecture-diagram.excalidraw`](docs/glider-architecture-diagram.excalidraw)

- **bserve** runs local WebSocket relay on port `19988`
- **extension** connects to relay + attaches a CDP debugger to tabs
- **CLI** sends commands through relay to control browser

## CLI

- use this extension with [glidercli](https://github.com/vdutts7/glidercli)

```bash
npm i -g glidercli
glider install    # start daemon
glider connect    # connect to browser
glider goto "https://example.com"
glider eval "document.title"
glider screenshot /tmp/page.png
```

- see the [glidercli README](https://github.com/vdutts7/glidercli) for full documentation

## Privacy

- **no data collection**: extension only communicates with `localhost`
- **no external servers**: all traffic stays on your machine
- **no tracking**: zero analytics/telemetry
- **open source**: full code visibility

More details → [PRIVACY.md](PRIVACY.md)

## Contact

<a href="https://vd7.io"><img src="https://res.cloudinary.com/ddyc1es5v/image/upload/v1773910810/readme-badges/readme-badge-vd7.png" alt="vd7.io" height="40" /></a> &nbsp; <a href="https://x.com/vdutts7"><img src="https://res.cloudinary.com/ddyc1es5v/image/upload/v1773910817/readme-badges/readme-badge-x.png" alt="/vdutts7" height="40" /></a>


## License

MIT

<!-- BADGES -->
[cws]: https://img.shields.io/badge/Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white
[cws-url]: https://chromewebstore.google.com/detail/glider/njbidokkffhgpofcejgcfcgcinmeoalj?hl=en-US
[github]: https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white
[github-url]: https://github.com/vdutts7/glider
[twitter]: https://img.shields.io/badge/Twitter-000000?style=for-the-badge&logo=Twitter&logoColor=white
[twitter-url]: https://x.com/vdutts7