// The phone's screen: a feed app the hand scrolls, a bug, and the fix arriving over the air.
// s = { scroll: flicks done (float), bug 0–1, fix 0–1 (the push), spin: free-running angle }
export const W = 590, H = 1280

const clamp = (x) => Math.min(Math.max(x, 0), 1)
const ss = (x, a, b) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const hash = (n) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x) }

// --- The feed, drawn once into a tall strip. ---------------------------------------------------------
const POST = 660, TOP = 250 // post height; the feed's header takes the first TOP px
const posts = [
  ['Priyanka Venkataraman-Holloway', '2h · Bengaluru', 'Sunday market run, finally found the good mangoes', ['#f6c16a', '#e2733f']],
  ['Arjun', '3h', 'new desk setup, who dis', ['#9ec5ff', '#4a6fd8']],
  ['Maya Okonkwo', '5h · Lagos', 'The light at 6pm here is unreal', ['#ffb3a7', '#b8487a']],
  ['Leo Fernández', '6h', 'Day 41 of learning the guitar. Still one song.', ['#b7e4c7', '#2d8a5f']],
  ['Sam', '8h', 'ok this ramen was worth the queue', ['#fde2a7', '#d9892b']],
  ['Nadia Rahman', '9h · Dhaka', 'Rain again. Chai again.', ['#c9c3ff', '#5b4bc4']],
  ['Theo Lindqvist', '11h · Malmö', 'Ferry to nowhere in particular', ['#a8e0f0', '#2b7fa6']],
  ['Ira Mehta', '12h', 'Tiny plant update: it lives', ['#d5f0a8', '#6b9a2c']],
  ['Kai', '1d', 'sunset, no filter, promise', ['#ffc4a3', '#e0567a']],
  ['Zoë Achterberg-Nakamura', '1d · Utrecht', 'Bike, bread, repeat', ['#f3d1ff', '#9b4fc0']],
  ['Omar Haddad', '1d · Amman', 'First snow of the year, apparently', ['#dfe7f2', '#6f86a8']],
  ['Bea', '2d', 'thrifted this lamp for 4 euros', ['#ffe0b2', '#c8793a']],
  ['Rafael Moreira dos Santos', '2d · Porto', 'Tram 28, window seat, finally', ['#ffd6d1', '#c4473a']],
  ['Mei', '2d', 'dumplings from scratch (ugly but good)', ['#f7e7c6', '#a8834a']],
  ['Jonas Weber', '3d · Leipzig', 'Late train, good book', ['#cfe8d6', '#3f7d5a']],
  ['Ananya Iyer', '3d', 'Beach cleanup crew, round two', ['#bfe6ff', '#2f7fb8']],
]
const feed = Object.assign(document.createElement('canvas'), { width: W, height: TOP + POST * posts.length })
{
  const c = feed.getContext('2d')
  c.fillStyle = '#fff'
  c.fillRect(0, 0, feed.width, feed.height)
  c.fillStyle = '#111'
  c.font = '700 56px system-ui'
  c.fillText('Feed', 36, 210)
  const fit = (text, max) => { // truncate with an ellipsis to fit max px
    if (c.measureText(text).width <= max) return text
    while (text.length && c.measureText(text + '…').width > max) text = text.slice(0, -1)
    return text + '…'
  }
  posts.forEach(([name, meta, caption, [a, b]], i) => {
    const y = TOP + i * POST
    const g = c.createLinearGradient(0, y + 110, 0, y + 540)
    g.addColorStop(0, a); g.addColorStop(1, b)
    c.fillStyle = b
    c.beginPath(); c.arc(72, y + 52, 30, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#111'; c.font = '600 28px system-ui'
    c.fillText(fit(name, 400), 118, y + 46)
    c.fillStyle = '#8a8a8f'; c.font = '400 24px system-ui'
    c.fillText(meta, 118, y + 80)
    c.save()
    c.beginPath(); c.roundRect(28, y + 108, W - 56, 432, 32); c.clip()
    c.fillStyle = g; c.fillRect(28, y + 108, W - 56, 432)
    c.fillStyle = 'rgba(255,255,255,0.55)' // a sun, so the block reads as a photo
    c.beginPath(); c.arc(W * (0.3 + 0.4 * hash(i)), y + 250, 60, 0, Math.PI * 2); c.fill()
    c.fillStyle = 'rgba(0,0,0,0.14)' // and a horizon
    c.beginPath(); c.moveTo(28, y + 540); c.lineTo(28, y + 440); c.quadraticCurveTo(W / 2, y + 360 + 60 * hash(i + 9), W - 28, y + 450); c.lineTo(W - 28, y + 540); c.fill()
    c.restore()
    c.fillStyle = '#111'; c.font = '600 24px system-ui'
    c.fillText(`${(1204 + i * 317).toLocaleString('en')} likes`, 36, y + 586)
    c.fillStyle = '#555'; c.font = '400 24px system-ui'
    c.fillText(fit(caption, W - 72), 36, y + 622)
  })
}

// The healthy app at a scroll position: the feed strip plus a fixed status bar.
function app(c, scroll) {
  c.drawImage(feed, 0, -scroll * POST) // main.js already shaped each flick (drag, then coast)
  c.fillStyle = '#fff'
  c.fillRect(0, 0, W, 120)
  c.fillStyle = '#111'; c.font = '600 30px system-ui'
  c.fillText('9:41', 70, 84)
}

// --- The bug and the fix. --------------------------------------------------------------------------
// Frozen: the feed stops, a scrim and spinner say it's hung. The fix clears it, then an "Updated" pill.
export function drawScreen(c, s) {
  c.textAlign = 'left'
  c.globalAlpha = 1
  app(c, s.scroll)
  const k = ss(s.bug, 0, 0.4) * (1 - ss(s.fix, 0.85, 1))
  if (k > 0) {
    c.fillStyle = `rgba(255,255,255,${0.75 * k})`
    c.fillRect(0, 0, W, H)
    c.save()
    c.globalAlpha = k
    c.translate(W / 2, 400) // above the resting thumb
    for (let i = 0; i < 12; i++) { // the classic 12-spoke spinner; it turns with the scroll
      c.save()
      c.rotate(s.spin + (i * Math.PI) / 6)
      c.fillStyle = `rgba(17,17,17,${0.15 + 0.85 * (i / 11)})`
      c.beginPath(); c.roundRect(-5, -52, 10, 26, 5); c.fill()
      c.restore()
    }
    c.fillStyle = '#111'; c.font = '600 30px system-ui'; c.textAlign = 'center'
    c.fillText('Feed isn’t responding', 0, 110)
    c.restore()
  }
  const t = ss(s.fix, 0.9, 1)
  if (t > 0) {
    c.save()
    c.globalAlpha = t
    c.translate(0, 12 * (1 - t))
    c.fillStyle = '#111'
    c.beginPath(); c.roundRect(W / 2 - 150, 140, 300, 64, 32); c.fill()
    c.fillStyle = '#fff'; c.font = '600 26px system-ui'; c.textAlign = 'center'
    c.fillText('Updated to v2.4', W / 2, 182)
    c.restore()
  }
}
