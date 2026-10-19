#!/bin/bash
# Two tabs. Home: activity, what runs (with Open, Switch and Stop), your models (else the recommended ones). Models:
# every model this machine can run, whatever card it lands on, as two-line rows to search, sort, start or switch to,
# download, remove and pin in place; those too big; those tested only on other cards. A model's page: one line of
# state, one action, what the registry says of it, the rest under details.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node - "$ROOT/Model.js" <<'JS'
const assert = require('assert'), fs = require('fs'), vm = require('vm'), c = {module: {exports: {}}};
vm.runInNewContext(fs.readFileSync(process.argv[2], 'utf8'), c);
const m = c.module.exports;
const gpu = (key, hw, name, extra) => ({key, hw, name, backend: key.split(':')[0], vramGb: 24, usedMiB: 500, tempC: 40, ...extra});
const rec = (id, name, extra) => ({id, name, family: 'qwen', cards: 1, format: 'EXL3 · 3 bpw', sizeGb: 14, ctx: 131072, engine: 'sglang', ...extra});
const base = {readiness: {state: 'ready'}, host: {freeRamGb: 40, ramGb: 64}, total: 0, life: {requests: 0, days: []}, agents: ['pi'],
  defaults: {agent: 'pi', folder: '/home/u'}, deployments: [], pins: []};
// a 3090, two B70s (one held by another program), a CPU
const s = {...base,
  gpus: [gpu('nvidia:0', 'rtx-3090-24gb', 'RTX 3090'), gpu('intel-xpu:0', 'b70', 'Arc Pro B70'), gpu('intel-xpu:1', 'b70', 'Arc Pro B70'),
    {key: 'cpu:0', hw: 'cpu', name: 'x86-64 AVX2 CPU', backend: 'cpu', ramGb: 64}],
  kinds: [
    {hw: 'rtx-3090-24gb', keys: ['nvidia:0'], free: ['nvidia:0'], taken: [], groups: [],
      models: [rec('q27.3090', 'Qwen3.8-27B'), rec('gemma.3090', 'Gemma 4 26B A4B', {family: 'gemma', engine: 'tabbyapi', format: 'EXL3 · 5.1 bpw'}),
        rec('flash.3090', 'Qwen3.8-Flash-Next', {needs: {host_ram_gb: 75, disk_gb: 85, fast_storage: 'nvme'}, unfit: 'needs 75 GB RAM, you have 40'})]},
    {hw: 'b70', keys: ['intel-xpu:0', 'intel-xpu:1'], free: ['intel-xpu:0'], taken: ['intel-xpu:1'],
      models: [rec('q27.b70', 'Qwen3.8-27B', {format: 'GGUF · Q4_K_M', engine: 'llama.cpp'})],
      groups: [rec('q35.b70x2', 'Qwen3.6-35B-A3B', {cards: 2, format: 'FP8'})]},
    {hw: 'cpu', keys: ['cpu:0'], free: ['cpu:0'], taken: [], groups: [], models: [rec('lfm.cpu', 'LFM2.5-2.6B', {family: 'lfm', format: 'GGUF · Q4_K_M'})]}]};
const home = (st, ui = {}) => m.build(st, {view: 'home', ...ui}).rows;
const tab = (st, ui = {}) => m.build(st, {view: 'models', ...ui}).rows;
// model, build, hardware
const table = rows => rows.filter(r => r.type === 'mrow').map(r => [r.title, r.quant, r.on].join(' | '));
const sec = rows => rows.filter(r => r.type === 'sec').map(r => r.label);
const opened = rows => rows[rows.findIndex(x => x.type === 'mrow' && x.open) + 1];
// a model's opened row, wherever it is listed: get models for one to download, home for one here
const box = (st, id, ui = {}) => { for (const v of ['models', 'home']) { const r = m.build(st, {view: v, open: 'm:' + id, ...ui}).rows; if (r.some(x => x.type === 'mrow' && x.open)) return opened(r) } };
let failed = 0;
function test(name, f) { try { f(); console.log('ok - ' + name) } catch (e) { failed++; console.error('not ok - ' + name + ': ' + e.message) } }

test('every model the machine can run, on any of its hardware, groups across cards included', () => {
  const all = m.catalog(s);
  assert.deepEqual(all.map(x => x.name + '@' + x.on), ['Qwen3.8-27B@RTX 3090', 'Gemma 4 26B A4B@RTX 3090', 'Qwen3.8-Flash-Next@RTX 3090',
    'Qwen3.8-27B@B70', 'Qwen3.6-35B-A3B@2× B70', 'LFM2.5-2.6B@CPU']);
  // a setup across more cards than the machine has is listed as too big, saying so, and opens nothing
  const one = m.catalog({...s, kinds: s.kinds.map(k => k.hw === 'b70' ? {...k, keys: ['intel-xpu:0']} : k)}).filter(x => x.n > 1);
  assert.deepEqual(one.map(x => [x.fits, x.unfit, x.action]), [[false, 'needs 2 × Arc Pro B70, this machine has 1', '']]);
});
test('a build reads as its model and a short label: the registry says, else its name and format do', () => {
  assert.deepEqual(['AWQ · INT4 W4A16 (g32, asym), BF16 linear attention', 'AWQ · FP8 W8A8', 'EXL3 · 3.05 bpw (55 GB RAM)', 'GGUF · Q4_K_M', 'ModelOpt · NVFP4']
    .map(f => m.quantOf({format: f})), ['INT4', 'FP8', 'EXL3 3.05 bpw', 'Q4_K_M', 'NVFP4']);
  assert.equal(m.quantOf({quant: 'EXL3 3.0bpw', format: 'EXL3 · 3 bpw'}), 'EXL3 3.0bpw');
  assert.deepEqual(['gemma-4-26B-A4B-it-AWQ-4bit', 'Qwen3.8-27B-AWQ-FP8', 'Qwen3.8-Flash-Next'].map(n => m.title({name: n})),
    ['gemma-4-26B-A4B', 'Qwen3.8-27B', 'Qwen3.8-Flash-Next']);
  assert.equal(m.title({name: 'Qwen3.8-27B-AWQ-FP8', model: {name: 'Qwen3.8-27B'}}), 'Qwen3.8-27B');
});
test('home: tabs, the grid, recommended models, the machine; no search, no Refresh', () => {
  const r = home(s);
  assert.deepEqual(r[0].items.map(t => t.label + (t.on ? '*' : '')), ['home*', 'get models']);
  assert.equal(r[1].type, 'life');
  assert.deepEqual(sec(r), ['RECOMMENDED', 'THIS MACHINE']);
  assert.deepEqual(table(r), ['Qwen3.8-27B | EXL3 3 bpw | RTX 3090', 'Qwen3.8-27B | Q4_K_M | B70', 'Qwen3.6-35B-A3B | FP8 | 2× B70', 'LFM2.5-2.6B | Q4_K_M | CPU']);
  // the pair of B70s is short a free card and nothing of yours runs there to switch from
  assert(r.filter(x => x.type === 'mrow')[2].dim);
  assert(r.filter(x => x.type === 'mrow').every(x => x.tags.some(t => t.text === 'best pick')));
  assert(!r.some(x => x.type === 'search' || x.type === 'slot' || (x.items || []).some(a => a.action === 'registry')));
});
test('home: what runs as cards, then what is ready to start, the best pick when it is not here, those pinned; a running card has Open, Switch and Stop', () => {
  const st = {...s, pins: ['gemma.3090', 'lfm.cpu'], kinds: s.kinds.map(k => k.hw === 'b70' ? {...k, models: [{...k.models[0], downloaded: true}]} : k),
    deployments: [{id: 'lfm.cpu', name: 'LFM2.5-2.6B', keys: ['cpu:0'], state: 'ready', agent: 'pi', session: {}}]};
  const r = home(st);
  // what runs is a card and no row; ready to start is here; the best pick for each card, not here yet; pinned
  assert.deepEqual(sec(r), ['READY TO START', 'BEST FOR THIS MACHINE', 'PINNED', 'THIS MACHINE']);
  assert.deepEqual(table(r), ['Qwen3.8-27B | Q4_K_M | B70', 'Qwen3.8-27B | EXL3 3 bpw | RTX 3090', 'Qwen3.6-35B-A3B | FP8 | 2× B70', 'Gemma 4 26B A4B | EXL3 5.1 bpw | RTX 3090']);
  const rows = r.filter(x => x.type === 'mrow');
  assert(rows.every(x => !x.live && x.drop && x.action === 'pick|m:' + x.id));
  // each row's one-click action: Start one that is here, Download one that is not
  assert.deepEqual(rows.map(x => x.act && x.act.action), ['run|q27.b70|intel-xpu:0', 'download|q27.3090', 'download|q35.b70x2', 'download|gemma.3090']);
  // ready to start reads as here, the rest as a download
  assert.deepEqual(rows.map(x => x.here + ':' + x.info.disk), ['true:here', 'false:download', 'false:download', 'false:download']);
  const card = r.find(x => x.type === 'run');
  assert.deepEqual([card.primary.label, card.primary.action, card.swap, card.more, card.stop], ['Open pi', 'open|lfm.cpu', 'models', 'more|lfm.cpu', 'stop|lfm.cpu']);
});
test('get models: a search field, what fits and is not here to download, sorted by how smart; too big and untested folded under their counts', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'cpu' ? {...k, models: [{...k.models[0], downloaded: true}]} : k),
    downloads: [{id: 'gemma.3090', state: 'download', detail: '3 of 20 GB', percent: 15}]};
  const r = tab(st);
  assert.deepEqual(r[0].items.map(t => t.label + (t.on ? '*' : '')), ['home', 'get models*']);
  assert.equal(r[1].hint, 'search 6 models: qwen, vision, coding…');
  assert.deepEqual(sec(r), ['TO DOWNLOAD', 'TOO BIG FOR THIS MACHINE']);
  assert.deepEqual(r.find(x => x.type === 'sec').items.map(x => x.label + (x.on ? '*' : '')), ['smart*', 'fast', 'small']);
  assert.deepEqual(table(r), ['Qwen3.8-27B | EXL3 3 bpw | RTX 3090', 'Qwen3.8-27B | Q4_K_M | B70', 'Qwen3.6-35B-A3B | FP8 | 2× B70']);
  assert(r.filter(x => x.type === 'mrow').every(x => x.info.disk === 'download' && x.act.label === 'Download'));
  // the download under way and the model on disk are on home: the download's progress on the right and as a bar, Cancel in a click
  const h = home(st).filter(x => x.type === 'mrow');
  assert.deepEqual([h[0].title, h[0].right, h[0].progress, h[0].act.label], ['Gemma 4 26B A4B', '↓ 15%', 15, 'Cancel']);
  assert.deepEqual([h[1].title, h[1].info.disk, h[1].info.size], ['LFM2.5-2.6B', 'here', '14 GB']);
  const fold = r.find(x => x.label === 'TOO BIG FOR THIS MACHINE');
  assert.deepEqual([fold.count, fold.open, fold.action], [1, false, 'big']);
  const big = tab(st, {big: true}).find(x => x.type === 'mrow' && x.title === 'Qwen3.8-Flash-Next');
  assert(big.dim && big.alert && !big.info);
  assert.deepEqual(big.meta, ['needs 75 GB RAM, you have 40']);
  // a search covers every model, those here too
  assert.deepEqual(table(tab(st, {query: 'lfm'})), ['LFM2.5-2.6B | Q4_K_M | CPU']);
});
test('a model row opens in place: what it is doing and Download first, then Download and start, Pin, Details', () => {
  const r = tab(s, {open: 'm:q27.3090'});
  assert.equal(opened(r).note, 'starts with a 14 GB download');
  assert(r.filter(x => x.type === 'mrow').every(x => x.drop));
  assert.deepEqual(opened(r).items.map(a => a.label + '=' + a.action), ['Download=download|q27.3090', 'Download and start ›=run|q27.3090|nvidia:0', 'Pin to home=pin|q27.3090',
    'Details ›=kind|rtx-3090-24gb|nvidia:0|q27.3090']);
});
test('downloaded, downloading, running and pinned rows offer what fits their state', () => {
  const st = {...s, pins: ['lfm.cpu'], kinds: s.kinds.map(k => k.hw === 'cpu' ? {...k, models: [{...k.models[0], downloaded: true}]} : k),
    downloads: [{id: 'gemma.3090', state: 'download', detail: '3 of 20 GB', percent: 15}],
    deployments: [{id: 'q27.b70', name: 'Qwen3.8-27B', keys: ['intel-xpu:0'], state: 'ready', agent: 'pi', session: {}}]};
  const at = id => box(st, id);
  // a model on this machine is on home already: no Pin
  assert.deepEqual(at('lfm.cpu').items.map(a => a.label), ['Start ›', 'Remove download', 'Details ›']);
  assert.equal(at('gemma.3090').note, 'downloading · 3 of 20 GB · 15%');
  assert.deepEqual(at('gemma.3090').items.map(a => a.action), ['run|gemma.3090|nvidia:0', 'download|gemma.3090|off', 'kind|rtx-3090-24gb|nvidia:0|gemma.3090']);
  // the running one is a card on home; its row is on get models' search
  const run = opened(tab(st, {query: 'b70', open: 'm:q27.b70'}));
  assert.deepEqual(run.items.map(a => a.label), ['Open ›', 'Stop', 'Details ›']);
  assert.equal(run.note, 'running on B70');
});
test('weights on disk an earlier version checked are on disk: Start, Remove download, no download size', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, models: k.models.map(x => x.id === 'q27.3090' ? {...x, onDiskGb: 14.01} : x.id === 'gemma.3090' ? {...x, onDiskGb: 7} : x)} : k)};
  const q = box(st, 'q27.3090');
  assert.equal(q.note, 'on disk; its files are checked when it first starts');
  assert.deepEqual(q.items.map(a => a.label), ['Start ›', 'Remove download', 'Details ›']);
  // half here: on home, saying what is left
  const g = home(st).find(x => x.id === 'gemma.3090');
  assert.deepEqual([g.info.disk, g.info.rest], ['part', '7 GB']);
  assert.deepEqual(sec(home(st)), ['READY TO START', 'BEST FOR THIS MACHINE', 'THIS MACHINE']);
});
test('the best pick is the smartest that answers at a usable speed; the fastest is marked; sort by smart, fast or small', () => {
  const sp = (d, aa, size) => ({speed: {decode: d, prefill: 300, at: '2026-10-15', source: 'lab'}, aa, sizeGb: size});
  const st = {...base, gpus: [s.gpus[0]], kinds: [{...s.kinds[0], models: [
    rec('int4', 'Qwen3.8-27B-AWQ-INT4', {...sp(15.7, 27.6, 29), model: {name: 'Qwen3.8-27B'}}),
    rec('fp8', 'Qwen3.8-27B-AWQ-FP8', {...sp(23.8, 27.6, 31), model: {name: 'Qwen3.8-27B'}}),
    rec('g26', 'gemma-4-26B-A4B-it-AWQ-4bit', {...sp(64, 16.7, 17), family: 'gemma'}),
    rec('g12', 'gemma-4-12B-it-AWQ-INT4', {...sp(47.7, 14.2, 11), family: 'gemma'})]}]};
  const rows = tab(st).filter(x => x.type === 'mrow');
  assert.deepEqual(rows.map(x => x.id + ':' + x.right + ':' + x.tags.map(t => t.text).join(',')),
    ['fp8:23.8 tok/s:best pick', 'int4:15.7 tok/s:', 'g26:64 tok/s:fastest', 'g12:47.7 tok/s:']);
  // how smart, against the smartest here, in five steps; its context and download
  assert.deepEqual(rows.map(x => x.info.pips), [5, 5, 3, 3]);
  assert.deepEqual([rows[0].info.ctx, rows[0].info.size, rows[0].info.disk], ['128K', '31 GB', 'download']);
  assert.deepEqual(tab(st, {sort: 'fast'}).filter(x => x.type === 'mrow').map(x => x.id), ['g26', 'g12', 'fp8', 'int4']);
  assert.deepEqual(tab(st, {sort: 'small'}).filter(x => x.type === 'mrow').map(x => x.id), ['g12', 'g26', 'int4', 'fp8']);
  // none fast enough: the fastest
  const slow = {...st, kinds: [{...st.kinds[0], models: st.kinds[0].models.slice(0, 2).map(x => ({...x, speed: {decode: x.speed.decode / 4}}))}]};
  assert.deepEqual(home(slow).filter(x => x.type === 'mrow').map(x => x.id), ['fp8']);
});
test('a card running one of your models offers Switch to this on every other model that fits it', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, free: []} : k),
    deployments: [{id: 'q27.3090', name: 'Qwen3.8-27B', keys: ['nvidia:0'], state: 'ready', agent: 'pi', session: {}}]};
  const r = tab(st, {open: 'm:gemma.3090'});
  assert.equal(opened(r).note, 'starts with a 14 GB download · Switch stops Qwen3.8-27B first');
  // not here: download it first, or download and switch
  assert.deepEqual(opened(r).items.slice(0, 2), [{label: 'Download', action: 'download|gemma.3090', primary: true}, {label: 'Download and switch ›', action: 'switch|q27.3090|gemma.3090|nvidia:0'}]);
  assert(!r.find(x => x.id === 'gemma.3090').dim);
  // here: Switch to this, in one click too
  const on = {...st, kinds: st.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, models: k.models.map(x => ({...x, downloaded: true}))} : k)};
  assert.deepEqual(box(on, 'gemma.3090').items[0], {label: 'Switch to this ›', action: 'switch|q27.3090|gemma.3090|nvidia:0', primary: true});
  assert.equal(home(on).find(x => x.id === 'gemma.3090').act.label, 'Switch ›');
  // a card another program holds offers nothing to switch from
  const held = {...st, kinds: st.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, taken: ['nvidia:0']} : k), deployments: []};
  const h = tab(held, {open: 'm:gemma.3090'});
  assert(!opened(h).items.some(a => /^(switch|run)\|/.test(a.action)));
  assert(h.find(x => x.id === 'gemma.3090').dim);
});
test('a card that shares the host memory offers Run alongside, within its share and what is free, restarting one that runs on its own', () => {
  const uni = {...s.gpus[0], key: 'nvidia:0', hw: 'spark', name: 'RTX Spark N1X', unified: true, vramGb: 120, usedMiB: null};
  const mk = (id, name, share, full) => rec(id, name, {engine: 'vllm', shareGb: share, fullGb: full, sizeGb: 30, downloaded: true});
  const st = {...base, host: {ramGb: 128, freeRamGb: 90}, gpus: [uni], kinds: [{hw: 'spark', keys: ['nvidia:0'], free: [], taken: [], groups: [],
    models: [mk('qwen', 'Qwen3.8-27B', 49.5, 89.6), mk('g26', 'Gemma 4 26B A4B', 39.3, 89.6), mk('g12', 'Gemma 4 12B', 34.9, 89.6), rec('llama', 'Other', {engine: 'llama.cpp'})]}],
    deployments: [{id: 'qwen', name: 'Qwen3.8-27B', keys: ['nvidia:0'], state: 'ready', agent: 'pi', session: {}, shareGb: 49.5, fullGb: 89.6}]};
  // on its own as validated: it restarts shared, giving back the rest of what it holds
  const g12 = box(st, 'g12');
  assert.deepEqual(g12.items.map(a => a.label + '=' + a.action).slice(0, 2), ['Switch to this ›=switch|qwen|g12|nvidia:0', 'Run alongside=alongside|g12|nvidia:0|qwen']);
  assert(/Run alongside: it shares the RTX Spark N1X's memory, taking 35 GB of the 43 GB left; Qwen3.8-27B restarts with a smaller cache first/.test(g12.note));
  // already shared: nothing restarts; too big for what is left: no Run alongside
  const sh = {...st, deployments: [{...st.deployments[0], share: 0.39}]};
  assert.equal(box(sh, 'g26').items[1].action, 'alongside|g26|nvidia:0');
  assert(!box({...sh, host: {ramGb: 128, freeRamGb: 40}}, 'g26').items.some(a => /^alongside/.test(a.action)));
  // an engine that cannot say what it takes, or a card with memory of its own
  assert(!box(st, 'llama').items.some(a => /^alongside/.test(a.action)));
  assert(!box({...st, gpus: [{...uni, unified: false}]}, 'g12').items.some(a => /^alongside/.test(a.action)));
  // a model started shared says so on home, and run again keeps it shared
  assert.equal(home({...sh, deployments: [{...sh.deployments[0]}]}).find(x => x.type === 'run').mem, '50 GB shared');
  const crashed = home({...sh, deployments: [{...sh.deployments[0], state: 'error', error: 'gone'}]}).find(x => x.crashed);
  assert.equal(crashed.run.action, 'again|qwen|nvidia:0|alongside');
});
test('models tested only on other cards are folded at the end, never startable, leading to the registry', () => {
  const st = {...s, untested: [{id: 'qwen3.8-flash-next', name: 'Qwen3.8-Flash-Next', family: 'qwen', aa: 39.8, quant: 'EXL3 2.05bpw', sizeGb: 62.8,
    hf: 'Qwen/Qwen3.8-Flash-Next', cards: ['RTX 3090', 'rtx-pro-6000-blackwell-96gb', 'RTX 5090']}]};
  const f = tab(st).find(x => x.label === 'NOT YET TESTED ON THIS CARD');
  assert.deepEqual([f.count, f.action, f.open], [1, 'untested', false]);
  // a search finds them too, by name or the cards they were tested on, never startable
  assert.deepEqual(tab(st, {query: 'flash 5090'}).filter(x => x.type === 'mrow').map(x => [x.title, x.dim]), [['Qwen3.8-Flash-Next', true]]);
  const r = tab(st, {untested: true, open: 'u:qwen3.8-flash-next'});
  const row = r.find(x => x.type === 'mrow' && x.title === 'Qwen3.8-Flash-Next' && x.dim);
  assert.deepEqual([row.quant, row.right, row.meta], ['EXL3 2.05bpw', 'smart 40', ['63 GB', 'tested on RTX 3090, RTX PRO 6000 Blackwell +1']]);
  assert.deepEqual(opened(r).items.map(a => a.action), ['url|https://local.sybilsolutions.ai/models/qwen3.8-flash-next/', 'url|https://huggingface.co/Qwen/Qwen3.8-Flash-Next']);
  assert(!opened(r).items.some(a => /^(run|switch|download)\|/.test(a.action)));
});
test('search matches name, build, family, engine, hardware and what a model can do, every word', () => {
  assert.deepEqual(table(tab(s, {query: 'qwen b70'})), ['Qwen3.8-27B | Q4_K_M | B70', 'Qwen3.6-35B-A3B | FP8 | 2× B70']);
  assert.deepEqual(table(tab(s, {query: 'GEMMA'})), ['Gemma 4 26B A4B | EXL3 5.1 bpw | RTX 3090']);
  assert.deepEqual(table(tab(s, {query: 'tabbyapi'})), ['Gemma 4 26B A4B | EXL3 5.1 bpw | RTX 3090']);
  const none = tab(s, {query: 'mistral'});
  assert(/Nothing matches “mistral”/.test(none.find(x => x.type === 'links').note));
  // what it can do, in the words people search with
  const seeing = {...s, kinds: s.kinds.map(k => ({...k, models: k.models.map(x => x.id === 'gemma.3090' ? {...x, caps: {vision: true}} : x)}))};
  assert.deepEqual(table(tab(seeing, {query: 'images'})), ['Gemma 4 26B A4B | EXL3 5.1 bpw | RTX 3090']);
  assert.equal(tab(seeing, {query: 'images'}).find(x => x.type === 'sec').label, '1 MATCH');
});
test('a model page: its build in the top line, what the registry says of it, what it needs under details', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, models: k.models.map(x => x.id === 'gemma.3090'
    ? {...x, aa: 16.7, speed: {decode: 64, prefill: 325, at: '2026-10-15', source: 'lab'}, model: {name: 'Gemma 4 26B A4B', about: 'A small MoE.', goodFor: 'Fast agents.', released: '2026-04-02'}} : x)} : k)};
  const p = m.build(st, {view: 'kind', id: 'rtx-3090-24gb', key: 'nvidia:0', model: 'gemma.3090', details: true});
  // the name is in the top line, once, with its maker's logo
  assert.deepEqual([p.where, p.whereFamily, p.hero.name], ['Gemma 4 26B A4B  EXL3 5.1 bpw', 'gemma', '']);
  assert.equal(p.hero.chips[0].text, '64 tok/s');
  const about = p.rows[p.rows.findIndex(x => x.label === 'ABOUT') + 1].note.split('\n\n');
  assert.deepEqual(about, ['A small MoE.', 'Good for: Fast agents.', 'Measured on this card: 64 tok/s writing, 325 tok/s reading, 2026-10-15, in the lab',
    'Released 2026-04-02 · smart 17 (Artificial Analysis Intelligence Index)']);
  assert.deepEqual(p.rows.filter(x => x.type === 'trow' && x.pair).map(x => x.cells.join('=')),
    ['format=EXL3 5.1 bpw', 'engine=tabbyapi', 'GPU=RTX 3090 · 24 GB', 'RAM=–', 'disk=14 GB', 'NVMe=no', 'context=128K tokens']);
  assert(!p.rows.some(x => (x.items || []).some(a => /^(pin|download|forget)\|/.test(a.action))));
});
test('one too big for the machine says why, with no Start', () => {
  const p = m.build(s, {view: 'kind', id: 'rtx-3090-24gb', key: 'nvidia:0', model: 'flash.3090'});
  assert.equal(p.rows[0].label, 'needs 75 GB RAM, you have 40');
  assert(!p.rows.some(x => (x.items || []).some(a => a.label === 'Start ›')));
});
test('a CPU-only machine, one where nothing fits, and one with only multi-card recipes all get a list', () => {
  const cpu = {...base, gpus: [s.gpus[3]], kinds: [s.kinds[2]]};
  assert.deepEqual(home(cpu).filter(x => x.type === 'mrow').map(x => x.title + ' | ' + x.quant), ['LFM2.5-2.6B | Q4_K_M']);
  const small = {...base, gpus: [s.gpus[0]], kinds: [{...s.kinds[0], models: [s.kinds[0].models[2]]}]};
  assert(/Nothing fits this machine yet/.test(home(small).find(x => x.type === 'links').note));
  assert.equal(tab(small).find(x => x.label === 'TOO BIG FOR THIS MACHINE').count, 1);
  assert(/No model fits this machine yet/.test(tab(small).find(x => x.type === 'links').chips[0].text));
  const pair = {...base, gpus: [s.gpus[1], {...s.gpus[2]}], kinds: [{...s.kinds[1], models: [], free: ['intel-xpu:0', 'intel-xpu:1'], taken: []}]};
  assert.deepEqual(table(home(pair)), ['Qwen3.6-35B-A3B | FP8 | 2× B70']);
});
test('full screen: the same two-line rows, the too big ones saying why', () => {
  const r = tab(s, {wide: true, big: true});
  assert(!r.some(x => x.type === 'thead' || x.type === 'trow'));
  assert.deepEqual(r.filter(x => x.type === 'mrow').pop().meta, ['needs 75 GB RAM, you have 40']);
});
test('a stale NVIDIA device list is a small banner under this machine, its Fix running setup; never on top', () => {
  const r = home({...s, cdi: {spec: '/etc/cdi/nvidia.yaml', why: '/dev/nvidia1 is gone'}});
  const b = r.find(x => x.type === 'banner');
  assert.deepEqual([b.text, b.alert, b.action], ['NVIDIA device list is out of date (/dev/nvidia1 is gone)', true, 'setup']);
  assert(r.indexOf(b) > r.findIndex(x => x.label === 'THIS MACHINE'));
  assert(!r.some(x => x.type === 'error'));
});
test('the registry line ends the models tab, quietly', () => {
  assert.equal(tab({...s, catalog: {commit: 'a9f394a7658d', at: ''}}).pop().text, 'models from the registry at a9f394a7');
});
test('the bar mark ripples while a download runs on its own', () => {
  assert.equal(m.build({...s, downloads: [{id: 'gemma.3090', state: 'download', percent: 3}]}, {view: 'home'}).mark, 'busy');
  assert.equal(m.build({...s, downloads: [{id: 'gemma.3090', state: 'error'}]}, {view: 'home'}).mark, '');
});
test('a running model page hides its address until clicked; full screen shows its model card', () => {
  const st = {...s, deployments: [{id: 'lfm.cpu', name: 'LFM2.5-2.6B', keys: ['cpu:0'], state: 'ready', agent: 'pi', port: 12434, address: 'http://172.30.0.5:12434', session: {all: {decode: 40}}}]};
  const p = m.build(st, {view: 'run', id: 'lfm.cpu', details: true});
  assert.equal(p.rows[0].note, 'running · 40 tok/s');
  // the address to send the key to is the gateway's on the model's Docker network, never 127.0.0.1:<port>
  const f = p.rows.find(x => x.icon === 'machine'); assert(f.secret); assert.equal(f.action, 'copy|http://172.30.0.5:12434');
  assert(!JSON.stringify(p.rows).includes('127.0.0.1'));
  const none = m.build({...st, deployments: [{...st.deployments[0], address: ''}]}, {view: 'run', id: 'lfm.cpu', details: true});
  assert(!none.rows.some(x => x.icon === 'machine'));
  const w = m.build(st, {view: 'run', id: 'lfm.cpu', wide: true, cards: {'lfm.cpu': '---\nlicense: x\n---\n# LFM\n![x](https://a/b.png)<img src=x><style>.a{b:c}</style><!-- n -->Hi'}});
  assert.equal(w.cardFor, 'lfm.cpu');
  assert.equal(w.rows.find(x => x.type === 'card').text, '# LFM\nHi');
  assert(!m.build(st, {view: 'run', id: 'lfm.cpu'}).rows.some(x => x.type === 'card'));
});
test('hardware: the machine in figures, then a line a card (maker, temperature, what it does) opening to its memory', () => {
  const st = {...s, host: {freeRamGb: 40, ramGb: 64, cpus: 48, cpuName: 'AMD EPYC 7413 24-Core Processor', diskFreeGb: 781, disk: 'nvme'},
    deployments: [{id: 'q27.b70', name: 'Qwen3.8-27B', keys: ['intel-xpu:0'], state: 'ready', agent: 'pi', session: {}}]};
  const r = m.build(st, {view: 'gpus'}).rows;
  assert.deepEqual(r[1].cells.map(c => c.v + c.u + ' ' + c.k), ['3 GPUs', '1/72GB VRAM used', '1 running', '40/64GB RAM free', '48 CPU threads', '781GB NVMe free']);
  const cards = r.filter(x => x.type === 'field' && x.logo);
  assert.deepEqual(cards.map(c => [c.logo, c.label, c.value, !!c.warn, c.action]), [['nvidia', 'RTX 3090', '40°  free', false, 'pick|hw:nvidia:0'],
    ['intel', 'Arc Pro B70', '40°  running', false, 'pick|hw:intel-xpu:0'], ['intel', 'Arc Pro B70', '40°  in use', true, 'pick|hw:intel-xpu:1']]);
  assert(!r.some(x => x.type === 'gpu'));
  const open = m.build(st, {view: 'gpus', open: 'hw:intel-xpu:0'}).rows;
  assert.equal(open.find(x => x.type === 'gpu').status, 'running Qwen3.8-27B');
  assert.equal(open.find(x => x.type === 'links').items[0].action, 'more|q27.b70');
  // the CPU: its name, threads and RAM, nothing else
  assert.deepEqual(r.filter(x => x.icon === 'machine').map(x => x.label + ' = ' + x.value), ['AMD EPYC 7413 = 48 threads · 64 GB']);
  // full screen shows every card opened
  assert.equal(m.build(st, {view: 'gpus', wide: true}).rows.filter(x => x.type === 'gpu').length, 3);
});
test('full screen opens a model page with its details shown', () => {
  const w = m.build(s, {view: 'kind', id: 'rtx-3090-24gb', key: 'nvidia:0', model: 'gemma.3090', wide: true});
  assert(!w.rows.some(x => x.label === 'details'));
  assert(w.rows.some(x => x.pair && x.cells[0] === 'engine'));
});
test('the models tab ranks by the Artificial Analysis index, highest first, those without one after', () => {
  const st = {...s, kinds: s.kinds.map(k => ({...k, models: k.models.map(x => ({...x, aa: {'gemma.3090': 16.7, 'q27.3090': 27.6, 'q27.b70': 27.6}[x.id]}))}))};
  const rows = tab(st).filter(x => x.type === 'mrow').map(x => x.title + ':' + (x.meta[0].indexOf('smart') === 0 ? x.meta[0].slice(6) : '–'));
  assert.deepEqual(rows, ['Qwen3.8-27B:28', 'Qwen3.8-27B:28', 'Gemma 4 26B A4B:17', 'Qwen3.6-35B-A3B:–', 'LFM2.5-2.6B:–']);
});
test('a recipe its publisher reported says so, on its row and its page', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, models: k.models.map(x => x.id === 'gemma.3090' ? {...x, reported: true} : x)} : k)};
  const r = tab(st, {open: 'm:gemma.3090'});
  assert(r.find(x => x.id === 'gemma.3090').tags.some(t => t.text === 'reported'));
  assert.equal(opened(r).note, 'starts with a 14 GB download · reported by its publisher, not yet run by the lab');
  assert.equal(m.build(st, {view: 'kind', id: 'rtx-3090-24gb', key: 'nvidia:0', model: 'gemma.3090'}).rows[0].note, 'starts with a 14 GB download · reported, not yet run by the lab');
});
test('two recipes that would read the same are told apart by what differs between them', () => {
  const st = {...s, kinds: s.kinds.map(k => k.hw === 'rtx-3090-24gb' ? {...k, models: k.models.concat([
    rec('glm.nvme', 'GLM-5.3-Flash', {family: 'glm', format: 'EXL3 · 3.05 bpw (55 GB RAM, experts on NVMe)'}),
    rec('glm.ram', 'GLM-5.3-Flash', {family: 'glm', format: 'EXL3 · 3.05 bpw (experts in RAM, CPU tier)'}),
    rec('q.256', 'Qwen3.5-9B', {ctx: 262144}), rec('q.128', 'Qwen3.5-9B', {ctx: 131072})])} : k)};
  assert.deepEqual(tab(st, {query: 'glm'}).filter(x => x.type === 'mrow').map(x => x.quant), ['EXL3 3.05 bpw · 55 GB RAM', 'EXL3 3.05 bpw · experts in RAM']);
  assert.deepEqual(tab(st, {query: '3.5-9b'}).filter(x => x.type === 'mrow').map(x => x.quant), ['EXL3 3 bpw · 256K ctx', 'EXL3 3 bpw · 128K ctx']);
  assert.equal(tab(st, {query: 'gemma'}).find(x => x.type === 'mrow').quant, 'EXL3 5.1 bpw');
});
process.exitCode = failed ? 1 : 0;
JS
