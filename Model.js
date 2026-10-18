// What the Local AI widget shows, as data: the backend's snapshot and the widget's ui state in, a view out.
// Panel.qml draws the view and turns its actions ("verb|arg|arg") into backend verbs. No Qt, no side effects.

// rounded before the unit is picked, so 999,950 is 1M, not 1000K, and a few MB are <0.1 GB, not 0 GB
function k(n) {
  n = n || 0
  var t = Math.round(n / 100) / 10
  return t >= 1000 ? Math.round(n / 1e5) / 10 + "M" : n >= 1e3 ? t + "K" : String(n)
}
function gb(n) { return (n >= 9.95 ? Math.round(n) : n > 0 && n < 0.05 ? "<0.1" : Math.round(n * 10) / 10) + " GB" }
function ctx(n) { return n >= 1024 ? Math.round(n / 1024) + "K" : String(n || 0) }
function dur(s) {
  s = Math.max(0, Math.round(s))
  return s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + ":" + ("0" + Math.floor(s % 3600 / 60)).slice(-2) + "h"
}
// how long ago a unix time was, in the fewest words: now, 12m ago, 10h ago, 3d ago
function ago(t) {
  var s = Date.now() / 1000 - (t || 0)
  return s < 300 ? "now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"
}
function home(dir) { return (dir || "").replace(/^\/home\/[^\/]+/, "~") }
function find(list, key, v) { return (list || []).filter(function(x) { return x[key] === v })[0] || null }
// a recipe this machine can run: one whose `needs` (RAM, disk, an NVMe drive) the backend found met; the best of a
// list is the first of those, the registry's order otherwise kept
function fits(r) { return !r.unfit }
function best(list) { return (list || []).filter(fits)[0] || null }
// downloading, starting, stopping, or a state this panel does not know yet: not settled either way
function working(d) { return d.state !== "ready" && d.state !== "error" }
// Stop, but nothing while it is already stopping
function stop(d) { return d.state === "stopping" ? "" : "stop|" + d.id }

function parse(text) { try { return JSON.parse(text) } catch (e) { return null } }

// APCA-W3 0.1.9 lightness contrast (Lc) of text on a background. Colors are {r, g, b} in 0..1, as Qt gives them.
// Every text and line color in the panel is picked by the Lc it must reach, so any theme stays readable.
function lum(c) { return 0.2126729 * Math.pow(c.r, 2.4) + 0.7151522 * Math.pow(c.g, 2.4) + 0.072175 * Math.pow(c.b, 2.4) }
function apca(text, bg) {
  var t = lum(text), b = lum(bg)
  if (t < 0.022) t += Math.pow(0.022 - t, 1.414)
  if (b < 0.022) b += Math.pow(0.022 - b, 1.414)
  if (Math.abs(b - t) < 0.0005) return 0
  var s = b > t ? (Math.pow(b, 0.56) - Math.pow(t, 0.57)) * 1.14 : (Math.pow(b, 0.65) - Math.pow(t, 0.62)) * 1.14
  return Math.abs(s) < 0.1 ? 0 : (s > 0 ? s - 0.027 : s + 0.027) * 100
}
function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 } }
// a translucent color as it lands on an opaque one
function over(c, bg) { var a = c.a === undefined ? 1 : c.a; return mix(bg, c, a) }
// the color closest to `from` on the way to `to` that reaches |Lc| >= target on bg; `to` when nothing does
function reach(from, to, bg, target) {
  if (Math.abs(apca(from, bg)) >= target) return mix(from, from, 0)
  if (Math.abs(apca(to, bg)) < target) return mix(to, to, 0)
  var lo = 0, hi = 1
  for (var i = 0; i < 24; i++) {
    var m = (lo + hi) / 2
    if (Math.abs(apca(mix(from, to, m), bg)) >= target) hi = m
    else lo = m
  }
  return mix(from, to, hi)
}
// The panel's tones, all measured on the card surface (the lighter of its two backgrounds, so the worst case):
// ink is for what matters now (a model's name, the primary action, a choice made), value for what a label
// names, label for every label, rule for lines and borders that are not text, alert for problems.
// A theme whose foreground is too soft to lead is pushed toward white (or black, on a light theme) until it does.
var LC = { ink: 90, value: 80, label: 60, rule: 15, alert: 60 }
function tones(ink, bg, surface, urgent) {
  var card = over(surface, bg), white = { r: 1, g: 1, b: 1 }, black = { r: 0, g: 0, b: 0 }
  var far = Math.abs(apca(white, card)) > Math.abs(apca(black, card)) ? white : black
  var top = reach(over(ink, bg), far, card, LC.ink)
  return { ink: top, value: reach(card, top, card, LC.value), label: reach(card, top, card, LC.label),
    rule: reach(card, top, card, LC.rule), alert: reach(urgent, top, card, LC.alert), alertRule: reach(urgent, top, card, LC.rule) }
}

// the bar mark: failed, busy, ready or idle
function mark(s) {
  var d = (s && s.deployments) || []
  if (d.some(function(x) { return x.state === "error" })) return "failed"
  if (d.some(working) || (s && s.downloads || []).some(function(x) { return x.state === "download" })) return "busy"
  return d.some(function(x) { return x.state === "ready" }) ? "ready" : ""
}

// a recipe's facts as chips (an icon name and a short text): its format, context, download size and the RAM it
// takes besides the card; a format's detail in parentheses is left to the registry
function fmt(f) { return (f || "").replace(/ · /g, " ").replace(/ \(.*\)$/, "") }
function ram(r) { return r.needs && r.needs.host_ram_gb ? Math.ceil(r.needs.host_ram_gb) + " GB RAM" : "" }
function spec(r) {
  return [r.format ? { text: fmt(r.format) } : null, r.ctx ? { icon: "context", text: ctx(r.ctx) } : null, r.sizeGb ? { icon: "weights", text: gb(r.sizeGb) } : null,
    ram(r) ? { icon: "memory", text: ram(r) } : null].filter(Boolean)
}
var SUPPORTED = "url|https://local.sybilsolutions.ai/hardware/"

// A model that stopped by itself: its row, framed, with run again (while its cards are still here) and dismiss, its
// reason under it, and, opened, its log and its page. Dismissing clears the failed mark it raises.
function stopped(s, ui) {
  return [].concat.apply([], (s.deployments || []).filter(function(d) { return d.state === "error" }).map(function(d) {
    var here = d.keys.every(function(k) { return find(s.gpus || [], "key", k) })
    // a recipe this version no longer offers cannot start again: dismiss only, and its download is listed below
    var row = { type: "slot", label: d.name, toggle: "pick|lost:" + d.id, open: ui.open === "lost:" + d.id, crashed: true,
      hint: d.offered === false ? "no longer offered" : "stopped",
      run: here && d.offered !== false ? { label: "run again ›", action: "again|" + d.id + "|" + d.keys.join(",") + (d.share ? "|alongside" : "") } : null, dismiss: "stop|" + d.id }
    var rows = [row, { type: "error", label: d.error || "stopped" }]
    if (row.open) rows.push({ type: "links", note: "", items: [{ label: "View logs", action: "log" }, { label: "Details ›", action: "more|" + d.id }] })
    return rows
  }))
}

// What the panel says and offers for each readiness state the backend reports (lib/access.sh). A state with no button
// clears by itself and says so; a state this table has never heard of does the same, so none is a dead end.
var READINESS = {
  "needs-setup": { note: "Once per machine: Docker access for your account (Omarchy's Sudoless Docker) and, on NVIDIA, the container toolkit. A terminal opens; Omarchy asks for your password.",
    action: "setup" },
  "docker-down": { note: "Docker is not ready. Local AI checks again by itself." },
  unsupported: { note: "This Omarchy is too old for Local AI. It checks again by itself once Omarchy is updated." },
  // only root can delete them, so the page that says how is the way out; the banner above says why
  "legacy-polkit": { note: "Nothing starts until those files are gone. Local AI checks again by itself, and this clears once they are." }
}
var LEGACY_POLKIT = "https://github.com/sybil-solutions/omarchy-local-ai/blob/main/docs/legacy-polkit.md"
function notReadyView(s, ui) {
  var r = s.readiness, t = READINESS[r.state] || { note: "Local AI is not ready. It checks again by itself." }
  var rows = [activity(s, ui), { type: "sec", label: "SETUP" }, { type: "links", note: t.note, items: [] }]
  // polkit files 6.0-6.4 left give programs of the account that set it up root: a red banner, with no way to dismiss it, until
  // they are gone; its message carries the same page, so it is not repeated
  if (r.state === "legacy-polkit") rows.unshift({ type: "banner", alert: true, action: "url|" + LEGACY_POLKIT, actionLabel: "How to remove them",
    text: "An earlier Local AI (6.0\u20136.4) left polkit files that let programs on this machine get root without a password. Remove them before using Local AI." })
  else if (r.message) rows.push({ type: "links", note: r.message, items: [] })
  if (t.action) rows.push({ type: "acts", items: [{ label: "Set up Local AI", action: t.action, primary: true }] })
  return { title: "LOCAL AI", version: s.version, rows: rows }
}

// home: your lifetime (once there is one), running models as cards (ready, then starting or stopping), then the
// available GPUs as rows: free ones, then groups of free cards, then crashed ones to run again or dismiss (a crash on
// a card no row shows is a row of its own). A GPU already running a model is not listed again; the rest are one
// "all GPUs" away.
function homeView(s, ui) {
  if (!s.gpus) return { title: "LOCAL AI", rows: [] }
  if (((s.readiness || {}).state || "ready") !== "ready") {
    // setup first, but a model that is already running stays reachable to open, stop or dismiss
    var nr = notReadyView(s, ui)
    ;(s.deployments || []).forEach(function(d) { nr.rows.push(card(s, d)) })
    return nr
  }
  if (!(s.kinds || []).length && !(s.deployments || []).length) return soonView(s, ui)
  if (ui.view === "models") return { title: "LOCAL AI", version: s.version, rows: [tabs(ui)].concat(modelsTab(s, ui)) }
  var rows = [tabs(ui), activity(s, ui)]
  ;(s.deployments || []).filter(function(d) { return d.state === "ready" })
    .concat((s.deployments || []).filter(function(d) { return working(d) })).forEach(function(d) { rows.push(card(s, d)) })
  // a model that stopped, to run again or dismiss
  rows = rows.concat(stopped(s, ui))
  rows = rows.concat(pinned(s, ui))
  rows = rows.concat(unoffered(s))
  rows.push({ type: "sec", label: "THIS MACHINE" })
  rows.push({ type: "field", icon: "gpu", label: "hardware", value: String(s.gpus.length), action: "gpus" })
  if (s.host && s.host.ramGb) rows.push({ type: "field", icon: "memory", label: "RAM", value: Math.floor(s.host.freeRamGb) + " / " + Math.floor(s.host.ramGb) + " GB free" })
  rows.push({ type: "field", icon: "agent", label: "Agents", value: String((s.agents || []).length), action: "agents" })
  rows.push({ type: "field", icon: "settings", label: "Settings", value: "", action: "settings" })
  // a stale NVIDIA device list (a card taken out, a driver update) stops starts on NVIDIA cards: setup rewrites it
  if (s.cdi && s.gpus.some(function(g) { return g.backend === "nvidia" }))
    rows.push({ type: "banner", alert: true, text: "NVIDIA device list is out of date (" + s.cdi.why + ")", action: "setup", actionLabel: "Fix" })
  return { title: "LOCAL AI", version: s.version, rows: rows }
}

// Two tabs: home (your activity, what runs, your pinned models) and models (every model, to find, download, pin)
function tabs(ui) {
  return { type: "tabs", items: [{ label: "home", on: ui.view !== "models", action: "home" }, { label: "models", on: ui.view === "models", action: "models" }] }
}

// a card's name short enough for a table cell: RTX 3090, B70, CPU
function short(name) {
  return /cpu/i.test(name) ? "CPU" : (name || "").replace(/^(NVIDIA |GeForce |Intel |AMD |Arc Pro |Arc |Radeon Pro |Radeon )+/, "")
}
// a format short enough for a table cell: EXL3 3 bpw
function brief(f) { return fmt(f).split(",")[0] }
// A build's short label, from the registry (quant) or read off its format: FP8, INT4, NVFP4, EXL3 3 bpw, Q4_K_M
function quantOf(r) {
  if (r.quant) return r.quant
  var f = r.format || "", m
  if ((m = f.match(/EXL3[^,(]*?(\d+(?:\.\d+)?)\s*bpw/i))) return "EXL3 " + m[1] + " bpw"
  if ((m = f.match(/\b(I?Q\d[_A-Z0-9]*)\b/))) return m[1]
  if ((m = f.match(/\b(NVFP4|MXFP4|FP8|INT8|INT4|BF16|FP16)\b/i))) return m[1].toUpperCase()
  return brief(f)
}
// A model's own name, without its build: the registry's (Qwen3.8-27B), else its recipe's with the quantizer's tail
// taken off (gemma-4-26B-A4B-it-AWQ-4bit is gemma-4-26B-A4B)
function title(r) {
  if (r.model && r.model.name) return r.model.name
  return (r.name || "").replace(/[-_ ](it[-_])?(AWQ|GPTQ|NVFP4|MXFP4|FP8|EXL3|GGUF|BF16|INT4|INT8)([-_ ].*)?$/i, "").replace(/-it$/, "") || r.name
}
// tok/s, one decimal under 100
function tps(n) { return n == null ? "" : (n < 100 ? Math.round(n * 10) / 10 : Math.round(n)) + " tok/s" }
// What a list is sorted by: smart (the Artificial Analysis index, the faster first on a tie), fast (measured decode),
// small (download size)
var SORTS = ["smart", "fast", "small"]
function sorter(by) {
  var aa = function(c) { return c.aa != null ? c.aa : -1 }, sp = function(c) { return c.speed != null ? c.speed : -1 }
  return by === "fast" ? function(a, b) { return sp(b) - sp(a) || aa(b) - aa(a) || a.at - b.at }
    : by === "small" ? function(a, b) { return (a.size || 0) - (b.size || 0) || aa(b) - aa(a) || a.at - b.at }
    : function(a, b) { return aa(b) - aa(a) || sp(b) - sp(a) || a.at - b.at }
}
// The best pick of a card's models: the smartest that fits and answers at a usable speed (20 tok/s, or not measured);
// when none is that fast, the fastest that fits. Ties go to the faster, then the registry's order.
var USABLE = 20
function pickBest(list) {
  var ok = (list || []).filter(fits), sp = function(r) { return r.speed && r.speed.decode != null ? r.speed.decode : null }
  var usable = ok.filter(function(r) { return sp(r) == null || sp(r) >= USABLE })
  var pool = usable.length ? usable : ok
  return pool.slice().sort(function(a, b) {
    return usable.length ? ((b.aa || 0) - (a.aa || 0) || (sp(b) || 0) - (sp(a) || 0)) : (sp(b) || 0) - (sp(a) || 0)
  })[0] || null
}

// Every model this machine can run, whatever card it lands on: one entry per recipe of each kind of hardware here,
// on one card or across a group of them (when the machine has that many). Each says where it runs, whether it runs
// now, whether it fits the machine (RAM, disk, NVMe), whether its cards are free, and whether it is pinned.
function catalog(s) {
  var out = [], pins = s.pins || []
  // two recipes that would read the same (a model, its format, its card) are told apart by what differs: the
  // detail their format carries, e.g. "55 GB RAM" against "experts in RAM"
  ;(s.kinds || []).forEach(function(kd, at) {
    var g = find(s.gpus || [], "key", kd.keys[0]), hw = g ? g.name : kd.hw
    var rec = {}, first = pickBest(kd.models)
    if (first) rec[first.id] = 1
    // the fastest that fits, when it is not the best pick already
    var quick = kd.models.filter(function(r) { return fits(r) && r.speed && r.speed.decode }).sort(function(a, b) { return b.speed.decode - a.speed.decode })[0]
    // a card of this kind running one of your models, which Switch stops to start another (never one another program holds)
    var on = (s.deployments || []).filter(function(x) { return x.keys.some(function(k) { return kd.keys.indexOf(k) >= 0 && kd.taken.indexOf(k) < 0 }) })
    var mine = on[0]
    // A card that shares the host memory can run another model alongside: each with a share sized to hold its whole
    // context, together within 72% of the memory. One running on its own, as validated, restarts shared first.
    var shared = !!g && !!g.unified && kd.keys.length === 1 && on.length > 0, ram = (s.host || {}).ramGb || 0
    var room = 0.72 * ram - on.reduce(function(a, x) { return a + (x.share ? x.share * ram : x.shareGb != null ? x.shareGb : Infinity) }, 0)
    // and what is free now, beside the desktop's 6 GB: a model that restarts shared gives back what it holds first
    var freed = on.reduce(function(a, x) { return a + (!x.share && x.state === "ready" && x.fullGb != null ? x.fullGb - x.shareGb : 0) }, 0)
    room = Math.min(room, ((s.host || {}).freeRamGb || 0) - 6 + freed)
    ;(kd.groups || []).forEach(function(gr) { if (fits(gr) && kd.keys.length >= gr.cards && !rec["n" + gr.cards]) rec["n" + gr.cards] = rec[gr.id] = 1 })
    kd.models.concat(kd.groups || []).forEach(function(r, i) {
      var n = r.cards || 1, short_ = kd.keys.length < n
      var d = (s.deployments || []).filter(function(x) { return x.id === r.id || x.id.indexOf(r.id + "--") === 0 })[0]
      // a setup across more cards than the machine has is listed as too big, saying how many it takes
      var sp = r.speed || {}, onDisk = !!r.downloaded || (r.sizeGb > 0 && r.onDiskGb >= r.sizeGb * 0.98)
      out.push({ id: r.id, name: r.name, title: title(r), quant: quantOf(r), family: r.family, format: r.format, engine: r.engine || "", ctx: r.ctx, size: r.sizeGb,
        needs: r.needs || {}, hw: hw, n: n, d: d || null, caps: r.caps || {}, model: r.model || {}, kinds: (s.kinds || []).length,
        speed: sp.decode != null ? sp.decode : null, prefill: sp.prefill != null ? sp.prefill : null, measured: sp.at || "", source: sp.source || "",
        fits: fits(r) && !short_, unfit: short_ ? "needs " + n + " × " + hw + ", this machine has " + kd.keys.length : r.unfit || "",
        downloaded: !!r.downloaded, onDisk: onDisk, part: !onDisk && r.sizeGb > 0 && r.onDiskGb > 0 ? Math.floor(r.onDiskGb / r.sizeGb * 100) : 0,
        dl: find(s.downloads || [], "id", r.id), reported: !!r.reported, aa: r.aa != null ? r.aa : null,
        free: kd.free.length >= n, pin: pins.indexOf(r.id), rec: !!rec[r.id], fastest: !!quick && quick === r && !rec[r.id] && kd.models.filter(fits).length > 1,
        at: at * 1000 + i, on: (n > 1 ? n + "× " : "") + short(hw),
        run: kd.free.length >= n && !short_ ? "run|" + r.id + "|" + kd.free.slice(0, n).join(",") : "",
        // a card busy with another of your models: stop it and start this one there
        swap: !d && n === 1 && kd.free.length < n && mine && fits(r) ? "switch|" + mine.id + "|" + r.id + "|" + mine.keys.filter(function(k) { return kd.keys.indexOf(k) >= 0 })[0] : "",
        swapFrom: mine ? [title(mine), quantOf(mine)].filter(Boolean).join(" ") : "",
        beside: !d && n === 1 && shared && fits(r) && r.shareGb != null && r.shareGb <= room
          ? "alongside|" + r.id + "|" + kd.keys[0] + (on.some(function(x) { return !x.share }) ? "|" + on.filter(function(x) { return !x.share }).map(function(x) { return x.id }).join(",") : "") : "",
        besideNote: shared && r.shareGb != null ? "Run alongside: it shares the " + short(hw) + "'s memory, taking " + gb(r.shareGb) + " of the " + gb(Math.max(0, room)) + " left"
          + (on.some(function(x) { return !x.share }) ? "; " + on.filter(function(x) { return !x.share }).map(function(x) { return [title(x), quantOf(x)].filter(Boolean).join(" ") }).join(", ") + " restarts with a smaller cache first" : "") : "",
        action: d ? "more|" + d.id : short_ ? "" : n > 1 ? "group|" + kd.hw + "|" + n + "|" + r.id : "kind|" + kd.hw + "|" + (kd.free[0] || kd.keys[0]) + "|" + r.id })
    })
  })
  // two that would read the same (a model, its build, its card) are told apart by the first thing that differs between
  // them: the detail their format carries (55 GB RAM, experts in RAM), the RAM they take, their context, their engine
  var ways = [function(c) { return ((c.format || "").match(/\(([^,)]+)/) || [])[1] || "" },
    function(c) { return c.needs.host_ram_gb ? Math.ceil(c.needs.host_ram_gb) + " GB RAM" : "" },
    function(c) { return c.ctx ? ctx(c.ctx) + " ctx" : "" }, function(c) { return c.engine }]
  out.forEach(function(c) {
    var twins = out.filter(function(o) { return o.title === c.title && o.on === c.on && o.quant === c.quant })
    if (twins.length < 2) return
    var by = ways.filter(function(f) { return twins.some(function(o) { return f(o) !== f(c) }) })[0]
    if (by && by(c)) c.variant = by(c)
  })
  return out
}
function matches(c, q) {
  var hay = [c.name, c.title, c.quant, c.family, brief(c.format), c.engine, c.on, c.hw].join(" ").toLowerCase()
  return q.split(/\s+/).every(function(w) { return hay.indexOf(w) >= 0 })
}
// A model as two lines: its maker's mark, its name and build, what is special about it (best pick, fastest), and its
// measured speed on the right; under them what it is to you: how smart, its context, its size and whether it is
// here, what it can do. A model that runs says so in place of its speed, one that loads or downloads its progress.
function mrow(c) {
  var tags = [], meta = [], right = "", progress = -1, live = !!c.d
  if (c.d) tags.push({ text: c.d.state === "ready" ? "running" : c.d.state === "error" ? "stopped" : c.d.state === "download" ? "downloading" : "starting", on: true })
  else if (c.rec && c.fits) tags.push({ text: "best pick", on: true })
  if (c.fastest && !c.d) tags.push({ text: "fastest" })
  if (c.reported) tags.push({ text: "reported" })
  if (c.d && c.d.state !== "ready" && c.d.state !== "error") {
    right = c.d.percent > 0 ? c.d.percent + "%" : "…"
    progress = c.d.percent > 0 ? c.d.percent : -1
  } else if (c.dl && c.dl.state === "download") {
    right = "↓ " + (c.dl.percent > 0 ? c.dl.percent + "%" : "…")
    progress = c.dl.percent > 0 ? c.dl.percent : -1
  } else right = tps(c.speed)
  if (!c.fits) meta.push(c.unfit)
  else {
    if (c.aa != null) meta.push("smart " + Math.round(c.aa))
    if (c.ctx) meta.push(ctx(c.ctx) + " ctx")
    if (c.size) meta.push(c.onDisk ? gb(c.size) + " on disk" : c.part > 0 ? gb(c.size * (100 - c.part) / 100) + " left to download" : gb(c.size) + " download")
    if (c.kinds > 1 || c.n > 1) meta.push(c.on)
    var caps = []
    if (c.caps.vision) caps.push("vision")
    if (c.caps.tools) caps.push("tools")
    if (c.caps.reasoning) caps.push("thinking")
    meta = meta.concat(caps)
  }
  return { type: "mrow", family: c.family || "", title: c.title, quant: c.variant ? c.quant + " · " + c.variant : c.quant, tags: tags, right: right,
    meta: meta, alert: !c.fits, here: c.onDisk, live: live, progress: progress, on: c.on, act: quick(c),
    // dim: nothing to do with it here now, neither start it nor switch to it
    dim: !c.d && (!c.fits || (!c.free && !c.swap)), action: c.action, id: c.id }
}
// The one thing a row does in a click, shown in place of its speed while the pointer is on it: Open a running model,
// Start one that is here or fits (a start downloads what is missing), Switch to it when your model holds its card,
// Cancel a download; nothing for one this machine cannot run
function quick(c) {
  if (c.d) return c.d.state === "ready" ? { label: "Open ›", action: "open|" + c.d.id } : null
  if (c.dl && c.dl.state === "download") return { label: "Cancel", action: "download|" + c.id + "|off" }
  if (!c.fits) return null
  if (c.free && c.run) return { label: "Start ›", action: c.run }
  if (c.swap) return { label: "Switch ›", action: c.swap }
  return null
}
// what is on this machine: all of it, or all but a draft or the rest of a download
function here(c) { return c.downloaded || c.onDisk || c.part > 0 }
// a list of models, each opening in place to manage it, on the page's own gutter like every other row
function list(cs, ui) {
  var rows = []
  cs.forEach(function(c) {
    var r = mrow(c)
    r.action = "pick|m:" + c.id
    r.open = ui.open === "m:" + c.id
    r.drop = true
    rows.push(r)
    if (r.open) rows.push(Object.assign(manage(c), { inset: true }))
  })
  return rows
}
// what a model is doing, in one line
function state(c) {
  if (c.d) return c.d.state === "ready" ? "running on " + c.on : c.d.state === "error" ? "stopped: " + (c.d.error || "the engine stopped") : (c.d.detail || c.d.state)
  if (c.dl) return c.dl.state === "error" ? "download failed: " + (c.dl.error || "try again") : "downloading · " + (c.dl.detail || "") + (c.dl.percent > 0 ? " · " + c.dl.percent + "%" : "")
  if (!c.fits) return c.unfit
  var here = c.downloaded ? "downloaded" : c.onDisk ? "on disk; its files are checked when it first starts"
    : c.part > 0 ? "on disk but for " + gb(c.size * (100 - c.part) / 100) + ", which Start downloads first" : "starts with a " + gb(c.size || 0) + " download"
  return here + (c.free ? "" : c.swap ? " · Switch stops " + c.swapFrom + " first" : " · its card is in use")
    + (c.reported ? " · reported by its publisher, not yet run by the lab" : "")
}
// what it is good for, in a sentence: the registry's, else nothing
function blurb(c) {
  var m = c.model || {}, t = m.goodFor || m.about || ""
  var one = (t.match(/^[\s\S]*?\.(?=\s|$)/) || [t])[0]
  return one.length > 180 ? one.slice(0, 177) + "…" : one
}
// a model's row opened: what it is good for and what it is doing, then Start (or Switch to it) or Open and Stop,
// Download, Cancel or Remove, Pin, Details
function manage(c) {
  var items = []
  if (c.d && c.d.state === "ready") items.push({ label: "Open ›", action: "open|" + c.d.id, primary: true }, { label: "Stop", action: stop(c.d), danger: true })
  else if (c.d) items.push({ label: "Stop", action: stop(c.d), danger: true })
  else if (c.fits && c.free && c.run) items.push({ label: "Start ›", action: c.run, primary: true })
  else if (c.swap) items.push({ label: "Switch to this ›", action: c.swap, primary: true })
  if (c.beside) items.push({ label: "Run alongside", action: c.beside })
  if (!c.d) {
    if (c.dl && c.dl.state === "download") items.push({ label: "Cancel download", action: "download|" + c.id + "|off" })
    else if (c.downloaded || c.onDisk) items.push({ label: "Remove download", action: "forget|" + c.id, danger: true })
    else if (c.fits) items.push({ label: c.dl || c.part ? "Resume download" : "Download", action: "download|" + c.id })
  }
  // a model on this machine is on home already; one that is not can be pinned there to try later
  if (!c.d && !c.dl && !c.downloaded && !c.onDisk) items.push({ label: c.pin >= 0 ? "Unpin" : "Pin to home", action: "pin|" + c.id + (c.pin >= 0 ? "|off" : "") })
  items.push({ label: "Details ›", action: c.action })
  var note = [blurb(c), state(c), c.beside ? c.besideNote : ""].filter(Boolean).join("\n")
  return { type: "links", note: note, items: items.filter(function(x) { return x.action !== undefined && x.action !== "" }) }
}
// Home's models, below what runs: those ready to start (here, all or nearly all, not running), then those you pinned to
// try; until there are any, the recommended ones. Every other model is a tab away.
function pinned(s, ui) {
  var all = catalog(s), by = ui.sort || "smart"
  var ready = all.filter(function(c) { return !c.d && (here(c) || (c.dl && c.dl.state === "download")) }).sort(sorter(by))
  var pins = all.filter(function(c) { return !c.d && !here(c) && !c.dl && c.pin >= 0 }).sort(function(a, b) { return a.pin - b.pin })
  var rows = []
  if (ready.length) rows = rows.concat([{ type: "sec", label: "READY TO START", note: "on this machine" }], list(ready, ui))
  if (pins.length) rows = rows.concat([{ type: "sec", label: "PINNED", note: "downloads when started" }], list(pins, ui))
  // until anything is here, the recommended ones; a model that runs or starts is enough (one that crashed is not)
  if (!ready.length && !pins.length && !(s.deployments || []).some(function(d) { return d.state !== "error" })) {
    var rec = all.filter(function(c) { return c.rec && c.fits })
    rows = rows.concat([{ type: "sec", label: "RECOMMENDED" }], rec.length ? list(rec, ui)
      : [{ type: "links", note: "Nothing fits this machine yet; the models tab says what each one needs.", items: [{ label: "Models ›", action: "models" }] }])
  }
  // the rest of the catalog, a click away
  var more = all.filter(function(c) { return c.fits && !c.d && !here(c) && c.pin < 0 }).length
  if (more) rows.push({ type: "field", icon: "down", label: more + (more === 1 ? " more model fits" : " more models fit") + " this machine", value: "browse", action: "models" })
  return rows
}
// What a recipe this version no longer offers left behind (an update withdrew it): each folder with its size and
// Remove, and each download that will not finish with Remove, so an update never strands gigabytes
function unoffered(s) {
  var u = s.unoffered || {}, f = u.folders || [], d = u.downloads || [], rows = []
  if (!f.length && !d.length) return rows
  rows.push({ type: "sec", label: "NO LONGER OFFERED" })
  f.forEach(function(x) {
    rows.push({ type: "field", icon: "weights", label: x.folder, value: gb(x.gb) })
    rows.push({ type: "links", items: [{ label: "Remove", action: "discard|" + x.folder }] })
  })
  d.forEach(function(x) {
    rows.push({ type: "field", icon: "down", label: x.id, value: "download stopped" })
    rows.push({ type: "links", items: [{ label: "Remove", action: "download|" + x.id + "|off" }] })
  })
  return rows
}
// the models tab: a search line (type anywhere), how to sort, then every model that fits, those this machine is too
// small for, and those tested only on other cards so far; each row opens in place to start, switch to, download,
// remove or pin it
function modelsTab(s, ui) {
  var all = catalog(s), q = (ui.query || "").trim().toLowerCase(), by = ui.sort || "smart"
  var rows = [{ type: "search", query: ui.query || "", hint: "type to search " + all.length + (all.length === 1 ? " model" : " models") }]
  if (q) {
    var hit = all.filter(function(c) { return matches(c, q) }).sort(function(a, b) { return (b.fits - a.fits) || sorter(by)(a, b) })
    rows.push({ type: "sec", label: "MATCHES" })
    return rows.concat(hit.length ? list(hit, ui) : [{ type: "links", note: "No model here matches “" + ui.query.trim() + "”. New ones arrive with Local AI updates.", items: [] }])
  }
  // what runs or is here, then what fits and needs a download first, each sorted the same way
  var ready = all.filter(function(c) { return c.d || here(c) || (c.dl && c.dl.state === "download") }).sort(sorter(by))
  var get = all.filter(function(c) { return c.fits && ready.indexOf(c) < 0 }).sort(sorter(by)), big = all.filter(function(c) { return !c.fits && !c.d })
  var sorts = SORTS.map(function(x) { return { label: x, on: x === by, action: x === by ? "" : "sort|" + x } })
  if (!ready.length && !get.length) rows.push({ type: "sec", label: "NOTHING FITS YET" })
  if (ready.length) rows = rows.concat([{ type: "sec", label: "READY TO START", note: "on this machine", items: sorts }], list(ready, ui))
  if (get.length) rows = rows.concat([{ type: "sec", label: "DOWNLOAD FIRST", note: get.length + (get.length === 1 ? " model" : " models"), items: ready.length ? null : sorts }], list(get, ui))
  if (big.length) {
    rows.push({ type: "field", label: "too big for this machine", value: String(big.length), drop: true, open: ui.big, action: "big" })
    if (ui.big) rows = rows.concat(list(big.sort(sorter(by)), ui))
  }
  rows = rows.concat(untested(s, ui))
  if (s.catalog && s.catalog.commit) rows.push({ type: "banner", text: "models from the registry at " + s.catalog.commit.slice(0, 8) + (s.catalog.at ? " · checked " + ago(Date.parse(s.catalog.at) / 1000) : "") })
  return rows
}
// Models tested on other cards and none of these that would fit this machine: folded, never started from here, each
// saying where it was tested and leading to its page in the registry, where testing it on more cards starts
var REGISTRY = "https://local.sybilsolutions.ai/models/"
// a card kind as people say it, when the catalog gives only its id: rtx-pro-4500-blackwell-32gb is RTX PRO 4500 Blackwell
function cardLabel(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return id
  return id.replace(/-\d+gb$/, "").split("-").map(function(w) {
    return /^(rtx|gtx|rx|pro|dgx|cmp|mi\d+x?|xt|ti|gb\d+|b\d+|m\d+|n\d+x)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
  }).join(" ")
}
function untested(s, ui) {
  var u = s.untested || []
  if (!u.length) return []
  var rows = [{ type: "field", label: "not yet tested on this card", value: String(u.length), drop: true, open: ui.untested, action: "untested" }]
  if (!ui.untested) return rows
  var out = []
  u.forEach(function(x) {
    var names = x.cards.map(cardLabel), where = names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "")
    var r = { type: "mrow", family: x.family || "", title: x.name, quant: quantOf(x), tags: [], right: x.aa != null ? "smart " + Math.round(x.aa) : "",
      meta: [gb(x.sizeGb), "tested on " + where], dim: true, drop: true, action: "pick|u:" + x.id, open: ui.open === "u:" + x.id }
    out.push(r)
    if (r.open) out.push({ type: "links", inset: true, note: "Tested on " + names.join(", ") + ". It has no recipe for this card yet, so Local AI cannot start it here; a recipe arrives once someone runs the tests on one.",
      items: [/^[a-z0-9][a-z0-9.-]*$/.test(x.id) ? { label: "In the registry ›", action: "url|" + REGISTRY + x.id + "/" } : null,
        x.hf ? { label: "Hugging Face ›", action: "url|https://huggingface.co/" + x.hf } : null].filter(Boolean) })
  })
  return rows.concat(out)
}

// Your lifetime as an activity grid: a column a week, a row a weekday, each day shaded in four steps by its tokens
// against your busiest day (days still to come are blank), the months under their first week, the totals above.
// Every home screen has it, empty before the first request: at least WEEKS weeks, ending this week.
var WEEKS = 26
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function activity(s, ui) {
  var life = s.life || {}, days = (life.days || []).slice(0, Math.max(0, (life.today || 0) + 1)), months = [], last = -1, first
  if (life.start && days.length) first = new Date(life.start * 1000)
  else {
    // nothing used yet: this week, Sunday to today
    var now = new Date()
    first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
    days = []
    for (var i = 0; i <= now.getDay(); i++) days.push(0)
  }
  // fewer weeks than the grid holds: empty weeks before the first
  // full screen has room for a year
  var pad = Math.max(0, ((ui || {}).wide ? 53 : WEEKS) - Math.ceil(days.length / 7)) * 7
  first.setDate(first.getDate() - pad)
  for (var p = 0; p < pad; p++) days.unshift(0)
  var top = Math.max.apply(null, days.concat([1]))
  // a week on the calendar, not 7 × 86400 s: the week a daylight-saving change ends is an hour longer
  for (var c = 0; c * 7 < days.length; c++) {
    var w = new Date(first.getTime())
    w.setDate(w.getDate() + c * 7)
    var m = w.getMonth()
    if (m !== last) months.push({ col: c, label: MONTHS[m] })
    last = m
  }
  // the first, partial month keeps its name unless the next one would crowd it
  if (months.length > 1 && months[1].col < 3) months.shift()
  return { type: "life", tokens: k(s.total) + " tokens", requests: k(life.requests) + (life.requests === 1 ? " request" : " requests"),
    since: life.since && life.requests > 0 ? "since " + life.since : "nothing run yet", months: months,
    cells: days.map(function(v, i) { return v > 0 ? Math.ceil(v / top * 4) : 0 }),
    // what a hovered day says: its date and its tokens
    labels: days.map(function(v, i) {
      var d = new Date(first.getTime())
      d.setDate(d.getDate() + i)
      return DAYS[d.getDay()] + " " + MONTHS[d.getMonth()] + " " + d.getDate() + "  " + (v > 0 ? k(v) + " tokens" : "no tokens")
    }) }
}

// A running model's card: its all-time token line, its name and cards, and Open, More and Stop (Stop and More while
// it starts)
function card(s, d) {
  var all = (d.session || {}).all || {}
  var cards = (s.gpus || []).filter(function(g) { return d.keys.indexOf(g.key) >= 0 })
  // a card that does not report its memory in use (Intel) shows only how much it has
  var known = cards.every(function(g) { return g.usedMiB != null })
  var used = cards.reduce(function(a, g) { return a + (g.usedMiB || 0) / 1024 }, 0)
  var total = cards.reduce(function(a, g) { return a + (g.vramGb || 0) }, 0)
  // its token line, only when it rises: a model whose tokens came at once draws a flat rule, which reads as a frame
  var ln = all.line || [], rises = ln.length > 2 && Math.max.apply(null, ln) > Math.min.apply(null, ln)
  // a card that shares the host memory has the machine's memory as its own: what the model holds of it says more
  var uni = cards.some(function(g) { return g.unified })
  var r = { type: "run", name: title(d), quant: quantOf(d), family: d.family, line: rises ? ln : [], more: "more|" + d.id,
    gpu: (cards.length > 1 ? cards.length + " × " : "") + (cards[0] ? cards[0].name : "GPU"),
    mem: d.share && s.host && s.host.ramGb ? Math.round(d.share * s.host.ramGb) + " GB shared"
      : uni ? (d.fullGb != null ? Math.round(d.fullGb) + " GB reserved" : "")
      : total && !working(d) ? (known ? Math.round(used) + " / " : "") + total + " GB" : "" }
  if (d.state === "ready") {
    r.chips = [all.decode ? { icon: "speed", text: all.decode + " tok/s" } : null, { icon: "tokens", text: k(all.tokens) }].filter(Boolean)
    r.primary = { label: "Open " + agentName(d.agent), action: "open|" + d.id }
    r.stop = stop(d)
    // another model in its place: the models tab, where each that fits offers Switch to this
    r.swap = "models"
  } else {
    r.progress = d.percent > 0 && d.state !== "stopping" ? d.percent : -1
    r.sub = (d.detail || d.state) + (r.progress >= 0 && d.state !== "download" ? " · " + d.percent + "%" : "")
    r.primary = { label: "Stop model", action: stop(d), quiet: true }
  }
  return r
}

// The hardware: the machine in figures first (cards, their memory, what runs, RAM, CPU threads, disk), then every
// card with its maker, memory in use, temperature and what is on it; a running one opens its model, a free one the
// models for it; then the CPU and the crashed models to run again or dismiss
function gpusView(s, ui) {
  var cards = (s.gpus || []).filter(function(g) { return g.backend !== "cpu" }), h = s.host || {}
  var vram = cards.reduce(function(a, g) { return a + (g.vramGb || 0) }, 0)
  var known = cards.filter(function(g) { return g.usedMiB != null })
  var used = known.reduce(function(a, g) { return a + g.usedMiB / 1024 }, 0)
  var rows = [{ type: "sec", label: "THIS MACHINE" }, { type: "grid", cells: [
    { v: String(cards.length), u: "", k: cards.length === 1 ? "GPU" : "GPUs" },
    // in use only where the card says (Intel's do not)
    { v: known.length ? Math.round(used) + "/" + vram : String(vram), u: "GB", k: known.length ? "VRAM used" : "VRAM" },
    { v: String((s.deployments || []).filter(function(d) { return d.state === "ready" }).length), u: "", k: "running" },
    { v: h.ramGb ? Math.floor(h.freeRamGb) + "/" + Math.floor(h.ramGb) : "–", u: "GB", k: "RAM free" },
    { v: h.cpus ? String(h.cpus) : "–", u: "", k: "CPU threads" },
    { v: h.diskFreeGb != null ? String(Math.floor(h.diskFreeGb)) : "–", u: "GB", k: h.disk === "nvme" ? "NVMe free" : "disk free" }] }]
  if (cards.length) rows.push({ type: "sec", label: cards.length === 1 ? "GPU" : "GPUS" })
  // a card is one line (maker, name, temperature, what it is doing); opened, its memory and where it leads
  cards.forEach(function(g) {
    var d = (s.deployments || []).filter(function(x) { return x.keys.indexOf(g.key) >= 0 })[0], kd = find(s.kinds || [], "hw", g.hw)
    var held = !d && ((kd && kd.taken.indexOf(g.key) >= 0) || g.held)
    var status = d ? (d.state === "ready" ? "running " : d.state === "error" ? "stopped: " : d.state + " ") + d.name
      : held ? "in use by another program" : kd ? "free" : "no tested model yet"
    var open = ui.open === "hw:" + g.key || ui.wide
    rows.push({ type: "field", logo: vendor(g), label: g.name, value: (g.display ? "display  " : "") + (g.tempC != null ? g.tempC + "°  " : "") + (d ? (d.state === "ready" ? "running" : d.state) : held ? "in use" : kd ? "free" : "–"),
      warn: held, drop: !ui.wide, open: open, action: ui.wide ? "" : "pick|hw:" + g.key })
    if (open) {
      var mem = gpuRow(g)
      mem.status = status
      rows.push(mem)
      rows.push({ type: "links", items: [d ? { label: "Open " + d.name + " ›", action: "more|" + d.id } : kd ? { label: "Models for it ›", action: "find|" + short(g.name) } : { label: "Supported hardware ›", action: SUPPORTED }] })
    }
  })
  var cpu = (s.gpus || []).filter(function(g) { return g.backend === "cpu" })[0]
  if (cpu) {
    rows.push({ type: "sec", label: "CPU" })
    // its maker's name without the marketing tail (24-Core Processor, (R), (TM), @ 3.2GHz)
    var cpuName = (h.cpuName || cpu.name).replace(/\((R|TM)\)/g, "").replace(/\s+(\d+-Core Processor|CPU\b.*|@.*)$/i, "").replace(/\s+/g, " ").trim()
    rows.push({ type: "field", icon: "machine", label: cpuName, value: (h.cpus ? h.cpus + " threads · " : "") + cpu.ramGb + " GB" })
  }
  var crashed = stopped(s, ui)
  if (crashed.length) rows = rows.concat([{ type: "sec", label: "STOPPED" }], crashed)
  return { back: true, where: "hardware", rows: rows }
}

// nothing to run on yet: the same home, its grid and this machine's hardware, each saying it has no tested model,
// what Local AI runs, and where the list of supported hardware lives
function soonView(s, ui) {
  var names = (s.gpus || []).map(function(g) { return g.name }), rows = [activity(s, ui), { type: "sec", label: "HARDWARE" }]
  names.filter(function(n, i) { return names.indexOf(n) === i }).forEach(function(n) {
    var c = names.filter(function(x) { return x === n }).length
    rows.push({ type: "field", icon: "gpu", label: (c > 1 ? c + " × " : "") + n, value: "no tested model yet" })
  })
  if (!names.length) rows.push({ type: "field", icon: "gpu", label: "no supported GPU found", value: "" })
  if (s.host && s.host.ramGb) rows.push({ type: "field", icon: "memory", label: "RAM", value: Math.floor(s.host.freeRamGb) + " / " + Math.floor(s.host.ramGb) + " GB free" })
  rows.push({ type: "links", note: "Local AI runs only models tested on your hardware. New ones arrive with Local AI updates as they are tested.", items: [] })
  rows.push({ type: "acts", items: [{ label: "Supported hardware ›", action: SUPPORTED }] })
  return { title: "LOCAL AI", version: s.version, rows: rows }
}

// A model's page, the same for a running model, a free card and a group: m is the running model (d) or the chosen
// recipe, with its cards, the models to choose from and what Run does. Its name and what it is, its token line and
// figures when it runs, its cards, what Open uses, its weights, where it answers when it runs, and Run or Log and Stop.
function page(s, ui, m) {
  var run = m.d, failed = run && run.state === "error", u = run ? run.session || {} : {}, all = u.all || {}, line = all.line || [], top = line.length ? line[line.length - 1] : 0
  var facts = spec(run ? Object.assign({}, m, { sizeGb: 0 }) : m), sp = m.speed || {}
  facts.splice(m.format ? 1 : 0, 0, { icon: "gpu", text: m.cards.length + " × " + (m.cards[0] ? m.cards[0].name : "GPU") })
  if (!run && sp.decode != null) facts.unshift({ icon: "speed", text: tps(sp.decode) })
  ;["vision", "tools", "reasoning"].forEach(function(c) { if ((m.caps || {})[c]) facts.push({ text: c === "reasoning" ? "thinking" : c }) })
  var v = { back: true, where: title(m) + "  " + quantOf(m), whereFamily: m.family, rows: [], hero: { name: "", family: "", chips: facts } }
  if (run && !failed) Object.assign(v.hero, { line: line, top: k(top) + " tokens", mid: k(Math.round(top / 2)), since: all.since || "", now: all.last ? ago(all.last) : "now" })
  // one line: what it is doing, or why it cannot start
  var dl = find(s.downloads || [], "id", run ? base(run.id) : m.id), held = (m.cards[0] || {}).status
  var said = failed ? run.error || "the engine stopped"
    : run ? (run.state === "ready" ? "running" + (all.decode != null ? " · " + all.decode + " tok/s" : "")
      : (run.detail || run.state) + (run.percent > 0 && run.state !== "stopping" ? " · " + run.percent + "%" : ""))
    : m.unfit ? m.unfit
    : !m.action ? (held ? "its " + m.cards[0].name + " is " + held : "its cards are in use")
    : dl && dl.state === "download" ? "downloading · " + (dl.detail || "") + (dl.percent > 0 ? " · " + dl.percent + "%" : "")
    : (m.downloaded ? "downloaded · ready to start" : m.sizeGb > 0 && m.onDiskGb >= m.sizeGb * 0.98 ? "on disk · its files are checked when it first starts"
      : m.sizeGb > 0 && m.onDiskGb > 0 ? "on disk but for " + gb(m.sizeGb - m.onDiskGb) + ", which Start downloads first"
      : "starts with a " + gb(m.sizeGb || 0) + " download") + (m.reported ? " · reported, not yet run by the lab" : "")
  v.rows.push(failed || m.unfit ? { type: "error", label: said } : { type: "links", note: said, items: [] })
  // one action, two when it runs: Open and Stop; none for a model this machine cannot run
  if (run && run.offered === false) v.rows.push({ type: "links", note: "no longer offered: once stopped, it cannot start again, and its download is listed on home to remove", items: [] })
  if (!m.unfit || run) v.rows.push({ type: "acts", items: failed && run.offered === false ? [{ label: "Dismiss", action: "stop|" + run.id, danger: true }]
    : failed ? [{ label: "Run again ›", action: "again|" + run.id + "|" + run.keys.join(",") + (run.share ? "|alongside" : ""), primary: true }, { label: "Dismiss", action: "stop|" + run.id, danger: true }]
    : run && run.state === "ready" ? [{ label: "Open " + agentName(run.agent) + " ›", action: "open|" + run.id, primary: true }, { label: "Stop", action: stop(run), danger: true }]
    : run ? [{ label: "Stop", action: stop(run), danger: true }]
    : [{ label: "Start ›", action: m.action || "", primary: true }] })
  about(v.rows, m)
  // full screen has room for its model card, from Hugging Face at the pinned revision
  v.cardFor = run ? base(run.id) : m.id
  if (ui.wide) {
    var text = (ui.cards || {})[v.cardFor]
    v.rows.push({ type: "sec", label: "MODEL CARD" })
    v.rows.push(text ? { type: "card", text: cardText(text) } : { type: "links", note: text === "" ? "no model card on Hugging Face" : "fetching the model card…", items: [] })
  }
  // the rest, one tap away: figures, what it needs, its cards, which agent and folder, its weights, where it answers
  // full screen opens with them shown
  if (!ui.wide) v.rows.push({ type: "field", label: "details", value: "", drop: true, open: !!ui.details, action: "details" })
  if (!ui.details && !ui.wide) return v
  if (run && !failed) v.rows.push({ type: "grid", cells: [
    { v: all.decode != null ? String(all.decode) : "–", u: "tok/s", k: "decode avg" },
    { v: all.prefill != null ? k(all.prefill) : "–", u: "tok/s", k: "prefill avg" },
    { v: all.ttft != null ? (all.ttft / 1000).toFixed(1) : "–", u: "s", k: "first token" },
    { v: k(u.tokens), u: "", k: "session" },
    { v: k(u.week), u: "", k: "week" },
    { v: isNaN(Date.parse(run.startedAt)) ? "–" : dur((Date.now() - Date.parse(run.startedAt)) / 1000), u: "", k: "up" }] })
  needsTable(v.rows, m)
  v.rows.push({ type: "sec", label: m.cards.some(function(g) { return g.cpu }) ? "CPU" : "GPUS" })
  m.cards.forEach(function(g) { v.rows.push(g) })
  v.rows.push({ type: "sec", label: "OPENS WITH" })
  pickers(s, v.rows, ui, run ? run.agent : (s.defaults || {}).agent, run ? run.folder : (s.defaults || {}).folder, run ? run.id : "")
  weights(v.rows, m.weights)
  if (run && !failed) {
    v.rows.push({ type: "sec", label: "REACH" })
    // addresses stay hidden until clicked, beside a copy. On this machine that is the gateway's address on the model's
    // Docker network, where the key is safe to send: no other account can listen there, while 127.0.0.1:<port> is
    // anyone's to bind the moment the gateway exits
    if (run.address) v.rows.push({ type: "field", icon: "machine", label: "this machine", value: run.address, secret: true, action: "copy|" + run.address })
    if (s.tailnet) v.rows.push(run.shared
      ? { type: "field", icon: "tailnet", label: "tailnet", value: run.shared, secret: true, action: "copy|" + run.shared }
      : { type: "field", icon: "tailnet", label: "tailnet", value: "share", action: "share|" + run.id })
    if (run.shared) v.rows.push({ type: "links", items: [{ label: "Stop sharing", action: "share|" + run.id + "|off" }] })
  }
  v.rows.push({ type: "links", items: [{ label: "View logs", action: "log" }] })
  return v
}

// What the registry says of a model: what it is, what it is good for, and how fast it ran on this card when tested
function about(rows, m) {
  var md = m.model || {}, sp = m.speed || {}, said = []
  if (md.about) said.push(md.about)
  if (md.goodFor) said.push("Good for: " + md.goodFor)
  if (sp.decode != null) said.push("Measured on this card: " + tps(sp.decode) + " writing" + (sp.prefill != null ? ", " + Math.round(sp.prefill) + " tok/s reading" : "")
    + (sp.at ? ", " + sp.at : "") + ({ lab: ", in the lab", reported: ", reported by its publisher", legacy: ", an earlier run" })[sp.source || "lab"])
  if (md.released) said.push("Released " + md.released + (m.aa != null ? " · smart " + Math.round(m.aa) + " (Artificial Analysis Intelligence Index)" : ""))
  else if (m.aa != null) said.push("smart " + Math.round(m.aa) + " (Artificial Analysis Intelligence Index)")
  if (!said.length) return
  rows.push({ type: "sec", label: "ABOUT" })
  rows.push({ type: "links", note: said.join("\n\n"), items: [] })
}

// A model card as the panel draws it: its markdown without the front matter, styles, HTML or images (nothing is loaded
// from the network to draw it), tables as rows of cells, and at most 40,000 characters
function cardText(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "")
    // an HTML table's cells apart, a row a paragraph; a lone rule of dashes left behind is no heading
    .replace(/<\/t[dh]>/gi, "  ·  ").replace(/<\/tr>/gi, "\n\n").replace(/^\s*[-=]{2,}\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]+>/g, "")
    // every other image form (reference ![a][r], collapsed ![a][], shortcut ![a], nested brackets) becomes a plain
    // link: Text.MarkdownText fetches an image's URL to draw it, but a link loads nothing until it is clicked
    .replace(/!\[/g, "[")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 40000)
}

// a second copy of a recipe runs as <recipe>--2
function base(id) { return id.indexOf("--") >= 0 ? id.slice(0, id.lastIndexOf("--")) : id }
// what a model takes of the machine, as a table: its format and engine, the cards it fills, system RAM besides them,
// disk for its weights, whether they must sit on NVMe, and its context
function needsTable(rows, m) {
  var n = m.needs || {}, cards = m.cards || [], g = cards[0] || {}
  rows.push({ type: "thead", cells: ["NEEDS", ""], pair: true })
  ;[["format", fmt(m.format) || "–"], ["engine", m.engine || "–"],
    [g.cpu ? "CPU" : "GPU", cards.length ? (cards.length > 1 ? cards.length + " × " : "") + g.name + (g.cpu ? "" : " · " + (g.mem || "").replace(/^.* \/ /, "")) : "–"],
    ["RAM", n.host_ram_gb ? Math.ceil(n.host_ram_gb) + " GB" : "–"], ["disk", gb(n.disk_gb || m.sizeGb || 0)],
    ["NVMe", n.fast_storage === "nvme" ? "required" : "no"], ["context", m.ctx ? ctx(m.ctx) + " tokens" : "–"]].forEach(function(x) {
    rows.push({ type: "trow", pair: true, cells: [x[0], x[1]] })
  })
}

function runView(s, id, ui) {
  var d = find(s.deployments, "id", id)
  if (!d) return null
  return page(s, ui, Object.assign({ d: d }, d, { cards: (s.gpus || []).filter(function(g) { return d.keys.indexOf(g.key) >= 0 }).map(gpuRow) }))
}

// a card kind's page, for the card its row was opened from (else the first free one): the models validated for it,
// the recommended one chosen until another is, and Run when that card is free; a card another program holds says why
function kindView(s, hw, ui) {
  var kd = find(s.kinds, "hw", hw), models = kd ? kd.models : [], pick = find(models, "id", ui.model) || best(models) || models[0]
  if (!pick) return null
  var key = kd.keys.indexOf(ui.key) >= 0 ? ui.key : kd.free[0], free = kd.free.indexOf(key) >= 0, g = key && find(s.gpus, "key", key)
  return page(s, ui, Object.assign({}, pick, { models: models, action: free ? "run|" + pick.id + "|" + key : "",
    cards: g ? [Object.assign(gpuRow(g), { status: kd.taken.indexOf(key) >= 0 ? "in use by another program" : g.busy ? "running a model" : "" })] : [] }))
}

// a group of free cards of a kind: the models validated for that many cards, on the cards it would run on
function groupView(s, hw, n, ui) {
  var kd = find(s.kinds, "hw", hw), models = kd ? (kd.groups || []).filter(function(x) { return x.cards === n }) : []
  var gr = find(models, "id", ui.model) || best(models) || models[0]
  if (!gr || kd.keys.length < n) return null
  // its cards: free ones to run on, else the first of the kind, with nothing to run until enough are free
  var free = kd.free.length >= n, keys = (free ? kd.free : kd.keys).slice(0, n)
  return page(s, ui, Object.assign({}, gr, { models: models, action: free ? "run|" + gr.id + "|" + keys.join(",") : "",
    cards: keys.map(function(key) { return gpuRow(find(s.gpus, "key", key)) }) }))
}

// the maker of a card, for its logo
function vendor(g) { return ({ nvidia: "nvidia", "intel-xpu": "intel", "amd-rocm": "amd" })[g.backend] || "" }
function gpuRow(g) {
  if (g.backend === "cpu") return { type: "gpu", cpu: true, name: g.name, bar: false, mem: g.ramGb + " GB RAM", temp: "" }
  var used = g.usedMiB != null ? g.usedMiB / 1024 : null
  return { type: "gpu", vendor: vendor(g), name: g.name, bar: used != null, pct: used != null && g.vramGb ? Math.min(100, Math.round(used / g.vramGb * 100)) : 0,
    mem: (used != null ? Math.round(used * 10) / 10 + " / " : "") + g.vramGb + " GB",
    temp: g.tempC != null ? g.tempC + "°" : "" }
}

function weights(rows, list) {
  if (!(list || []).length) return
  rows.push({ type: "sec", label: "WEIGHTS" })
  list.forEach(function(w) {
    rows.push({ type: "field", logo: "hf", label: "hugging face", value: w.repository,
      action: "url|https://huggingface.co/" + w.repository + "/tree/" + w.revision })
  })
}

// Agent identity and actions keep the same rows and buttons as the rest of the panel.
function agentName(a) {
  return ({ pi: "pi", claude: "Claude Code", codex: "Codex", opencode: "OpenCode", omp: "oh-my-pi",
    crush: "Crush", grok: "Grok", copilot: "GitHub Copilot", hermes: "Hermes" })[a] || a || "Choose an agent"
}
// The agent: closed, one row with the one chosen; opened, every agent once, the chosen one marked (a check, an ink
// bar), each of the others choosing itself. Then default and update for the chosen one, and the folder.
// an agent's newer version, when its manager has one (outdated.json): "Update to 2.1.292"
function update(s, ui, a) {
  var u = (s.updates || {})[a]
  return u ? { label: ui.updatingAgent === a ? "Updating…" : "Update to " + u.latest, action: ui.updatingAgent ? "" : "update|" + a } : null
}
function pickers(s, rows, ui, agent, folder, id, always) {
  // on the agents page choosing sets the default; on a model it sets that model's agent
  var choose = function(a) { return always ? "default|" + a : "set|agent|" + encodeURIComponent(a) + "|" + id }
  if (ui.open === "agent" || always) (s.agents || []).forEach(function(a) {
    rows.push({ type: "agent", agent: a, label: agentName(a), on: a === agent, action: a === agent ? (always ? "" : "pick|agent") : choose(a) })
  })
  else rows.push({ type: "agent", agent: agent || "", label: agentName(agent), on: true, drop: true, action: "pick|agent" })
  var u = !always && agent && update(s, ui, agent)
  if (u) rows.push({ type: "links", items: [u] })
  rows.push({ type: "field", icon: "folder", label: "folder", value: home(folder),
    action: "folder|" + id + "|" + encodeURIComponent(folder || "") })
}

function agentsView(s, ui) {
  var rows = [{ type: "sec", label: "DEFAULT AGENT" }]
  pickers(s, rows, ui, (s.defaults || {}).agent, (s.defaults || {}).folder, "", true)
  // only agents with a newer version, each with its update
  var ups = (s.agents || []).map(function(a) { return [a, update(s, ui, a)] }).filter(function(x) { return x[1] })
  if (ups.length) {
    rows.push({ type: "sec", label: "UPDATES" })
    ups.forEach(function(x) {
      rows.push({ type: "field", label: agentName(x[0]), value: (s.updates[x[0]].current || "") + " → " + s.updates[x[0]].latest })
      rows.push({ type: "links", items: [x[1]] })
    })
  }
  return { back: true, where: "agents", rows: rows }
}

// The agent's folder: the folder being looked at, a button to use it, recent folders, then its parent and subfolders
// (the backend's dirs). Clicking only, nothing is typed or pasted.
function folderView(s, ui) {
  var b = ui.browse, id = ui.id || "", rows = []
  if (!b) return { back: true, where: "folder", rows: [{ type: "field", label: "reading folders", value: "…" }] }
  var go = function(p) { return "browse|" + encodeURIComponent(p) }
  rows.push({ type: "sec", label: "THE AGENT'S FOLDER" })
  rows.push({ type: "field", icon: "folder", label: "this folder", value: home(b.path) })
  rows.push({ type: "links", items: [{ label: "Use this folder", action: "usefolder|" + id + "|" + encodeURIComponent(b.path) }] })
  var recent = (s.folders || []).filter(function(f) { return f !== b.path }).slice(0, 4)
  if (recent.length) {
    rows.push({ type: "sec", label: "RECENT" })
    recent.forEach(function(f) { rows.push({ type: "field", icon: "folder", label: home(f), value: "", action: go(f) }) })
  }
  rows.push({ type: "sec", label: "FOLDERS" })
  if (b.parent) rows.push({ type: "field", icon: "up", label: "up to " + home(b.parent), value: "", action: go(b.parent) })
  b.dirs.forEach(function(d) { rows.push({ type: "field", icon: "folder", label: d, value: "", action: go(b.path.replace(/\/$/, "") + "/" + d) }) })
  if (!b.dirs.length) rows.push({ type: "field", label: "no folders inside", value: "" })
  return { back: true, where: "folder", rows: rows }
}

// Settings: usage reporting, off until turned on here or with Allow on home (never with DO_NOT_TRACK), and exactly what
// it sends
var REPORTING = "Reporting is minimal and anonymous. There is no user or account ID: at most twice a day Local AI sends " +
  "a random number made on this computer, its version, the kinds of graphics card it found, how many models are running, " +
  "and how many models it started, failed to start, opened in an agent or downloaded since the last report. It never " +
  "sends your prompts, files, folders, model names or agents, and your IP address is not stored. Until you turn it on, " +
  "and once you turn it off, nothing is sent and counts not yet sent are deleted."
function settingsView(s, ui) {
  var on = s.reporting === "on", rows = [{ type: "sec", label: "USAGE REPORTING" }]
  if (s.reporting === "env") rows.push({ type: "field", label: "send usage reports", value: "off (DO_NOT_TRACK is set)" })
  else rows.push({ type: "field", icon: on ? "check" : "", label: "send usage reports", value: on ? "on" : "off",
    action: "set|ping|" + (on ? "off" : "on") })
  rows.push({ type: "links", note: REPORTING, items: [{ label: "See the public totals", action: "url|https://usage.sybilsolutions.ai/" }] })
  return { back: true, where: "settings", rows: rows }
}

function build(s, ui) {
  s = s || {}
  var v = (ui.view === "settings" ? settingsView(s, ui) : ui.view === "folder" ? folderView(s, ui) : ui.view === "agents" ? agentsView(s, ui) : ui.view === "run" ? runView(s, ui.id, ui) : ui.view === "kind" ? kindView(s, ui.id, ui) : ui.view === "gpus" ? gpusView(s, ui) : ui.view === "group" ? groupView(s, ui.id, Number(ui.key), ui) : null) || homeView(s, ui)
  // A page has one way back, up to where it belongs: a model's page to the tab it was opened from, the folder to what
  // it is for, every other page to home
  if (v.back) v.up = ui.view === "folder" ? (ui.id ? { label: "model", action: "more|" + ui.id } : { label: "agents", action: "agents" })
    : /^(run|kind|group)$/.test(ui.view) && ui.from === "models" ? { label: "models", action: "models" } : { label: "home", action: "home" }
  // usage reporting is off until you choose: home asks once, and either answer is kept and ends the question; No thanks
  // comes first, so the first keyboard focus never turns it on
  if (s.reporting === "unset" && (!ui.view || ui.view === "home"))
    v.rows.unshift({ type: "links", note: "Share minimal, anonymous usage counts to help Local AI? Nothing is sent unless you allow it.",
      items: [{ label: "No thanks", action: "set|ping|off" }, { label: "Allow", action: "set|ping|on" }, { label: "What is sent", action: "settings" }] })
  // a plugin release, on the home page: Omarchy's own update, in a terminal, shows what changes and asks
  if (s.pluginUpdate && (!ui.view || ui.view === "home"))
    v.rows.unshift({ type: "links", note: "A new version of Local AI is out.",
      items: [{ label: ui.updatingAgent === "plugin" ? "Updating…" : "Update Local AI", action: ui.updatingAgent ? "" : "update|plugin" }] })
  if (ui.problem || ui.pollProblem || s.setupError) v.rows.unshift({ type: "error", label: ui.problem || ui.pollProblem || s.setupError })
  else if (ui.notice) v.rows.unshift({ type: "banner", text: ui.notice })
  return Object.assign(v, { mark: ui.problem || ui.pollProblem || s.setupError ? "failed" : mark(s) })
}

if (typeof module !== "undefined") module.exports = { build: build, parse: parse, tones: tones, catalog: catalog, cardText: cardText, quantOf: quantOf, title: title }
