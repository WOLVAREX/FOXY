import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL, pathToFileURL } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = process.cwd();

// === NATIVE HTTP (no npm deps) ===
function nativeGet(url, opts = {}, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 10) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(e); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  opts.headers || {},
      timeout:  opts.timeout || 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(nativeGet(res.headers.location, opts, _redirects + 1));
      }
      resolve(res);
    });
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function nativeGetText(url, opts = {}) {
  return nativeGet(url, opts).then(res => new Promise((resolve, reject) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => resolve(data));
    res.on('error', reject);
  }));
}

function nativeDownload(url, destPath, opts = {}) {
  return nativeGet(url, { ...opts, timeout: 120000 }).then(res => new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  }));
}

function extractZip(zipPath, destDir) {
  let result = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'pipe' });
  if (!result || result.status !== 0) {
    result = spawnSync('python3', ['-c',
      `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
      zipPath, destDir
    ], { stdio: 'pipe' });
  }
  if (!result || (result.status !== 0 && result.status !== null)) {
    throw new Error('Zip extraction failed — unzip and python3 both unavailable or failed');
  }
}

// === PATHS ===
const TEMP_DIR    = path.join(__dirname, '.fbot', 'cache', 'core_bundle');
const EXTRACT_DIR = path.join(TEMP_DIR, 'core');

// === CONFIG ===
const REPO_JSON_URL = 'https://courageous-alpaca-0e1682.netlify.app/lp.json';
const LOCAL_SETTINGS     = path.join(__dirname, 'settings.js');
const EXTRACTED_SETTINGS = path.join(EXTRACT_DIR, 'settings.js');
const ENV_FILE           = path.join(__dirname, '.env');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ── ORANGE Colour Palette ──────────────────────────────────────────────
const _O   = '\x1b[38;2;255;165;0m';    // orange primary
const _O2  = '\x1b[38;2;255;140;0m';    // dark orange
const _OD  = '\x1b[38;2;200;100;0m';    // deeper orange
const _YL  = '\x1b[38;2;255;200;50m';   // amber/yellow
const _RD  = '\x1b[38;2;255;80;80m';    // red for errors
const _WHT = '\x1b[38;2;255;220;180m';  // warm white
const _DIM = '\x1b[2m';
const _BD  = '\x1b[1m';
const _R   = '\x1b[0m';

// ── Box helpers ────────────────────────────────────────────────────────
const _INNER = 34;
const _dash  = (n) => '─'.repeat(Math.max(0, n));

function _boxTop(icon, label) {
  const title = `〔 ${icon} ${label} 〕`;
  const rpad  = Math.max(2, _INNER - title.length + 4);
  return `${_BD}${_O}┌──${title}${_dash(rpad)}┐${_R}`;
}
function _boxBot() { return `${_BD}${_O}└${_dash(_INNER + 4)}┘${_R}`; }
function _boxRow(lbl, val) {
  const pad = ' '.repeat(Math.max(0, 9 - lbl.length));
  return `  ${_O}▣${_R}  ${_DIM}${lbl}${pad}${_R}${_O2}:${_R} ${_WHT}${val}${_R}`;
}

// ── Inline step logger ────────────────────────────────────────────────
function step(icon, label, val) {
  const lbl = (label + '             ').slice(0, 13);
  const sep = val !== undefined ? ` ${_DIM}──${_R} ${_WHT}${val}${_R}` : '';
  process.stdout.write(`${_OD}[FOXY-LOAD]${_R} ${_O}▸${_R} ${icon}  ${_BD}${_O2}${lbl}${_R}${sep}\n`);
}

function err(msg) {
  process.stderr.write(`${_RD}${_BD}[FOXY-LOAD]${_R} ${_RD}✖  ${msg}${_R}\n`);
}
function warn(msg) {
  process.stdout.write(
    `\n${_YL}${_BD}┌──〔 ⚠ WARNING 〕────────────────────────┐${_R}\n` +
    `${_YL}  ${msg}${_R}\n` +
    `${_YL}${_BD}└──────────────────────────────────────────┘${_R}\n\n`
  );
}
function ok(msg)  { step('✅', msg); }
function log(msg) { step('ℹ️ ', msg); }

// ── Startup banner ────────────────────────────────────────────────────
const _BG   = '\x1b[38;2;255;165;0m';   // orange
const _BG2  = '\x1b[38;2;255;200;100m'; // light orange
const _BDW  = '\x1b[1m';
const _RW   = '\x1b[0m';

process.stdout.write(
  `\n${_BDW}${_BG}` +
  `  ┌─────────────────────────────────────────┐\n` +
  `  │  🦊  ${_RW}${_BDW}${_BG}FOXYBOT${_RW}                              ${_BDW}${_BG}│\n` +
  `  │  ${_RW}${_BG2}Advanced WhatsApp Bot by FOXY TECH${_RW}    ${_BDW}${_BG}  │\n` +
  `  │  ${_RW}${_BG2}Initializing... please wait${_RW}           ${_BDW}${_BG}  │\n` +
  `  └─────────────────────────────────────────┘${_RW}\n\n`
);

// ── Live banner ──────────────────────────────────────────────────────
function showLiveBanner() {
  const O  = '\x1b[38;2;255;165;0m';    // orange primary
  const O2 = '\x1b[38;2;255;140;0m';    // dark orange
  const DO = '\x1b[38;2;200;100;0m';    // deeper orange
  const W  = '\x1b[38;2;255;220;180m';  // warm white
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';
  process.stdout.write('\n' + [
    `${B}${O}  ╔═══════════════════════════════════════════╗${R}`,
    `${B}${O}  ║                                           ║${R}`,
    `${B}${O}  ║   🦊  ${W}FOXYBOT${O}                           ║${R}`,
    `${B}${O}  ║                                           ║${R}`,
    `${B}${DO}  ║   ${O}███████╗ ██████╗ ██╗  ██╗██╗   ██╗   ${DO}║${R}`,
    `${B}${DO}  ║   ${O}██╔════╝██╔═══██╗╚██╗██╔╝╚██╗ ██╔╝   ${DO}║${R}`,
    `${B}${DO}  ║   ${O}█████╗  ██║   ██║ ╚███╔╝  ╚████╔╝    ${DO}║${R}`,
    `${B}${DO}  ║   ${O}██╔══╝  ██║   ██║ ██╔██╗   ╚██╔╝     ${DO}║${R}`,
    `${B}${DO}  ║   ${O}██║     ╚██████╔╝██╔╝ ██╗   ██║      ${DO}║${R}`,
    `${B}${DO}  ║   ${O}╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝      ${DO}║${R}`,
    `${B}${DO}  ║      ${O}██████╗  ██████╗ ████████╗          ${DO}║${R}`,
    `${B}${DO}  ║      ${O}██╔══██╗██╔═══██╗╚══██╔══╝          ${DO}║${R}`,
    `${B}${DO}  ║      ${O}██████╔╝██║   ██║   ██║             ${DO}║${R}`,
    `${B}${DO}  ║      ${O}██╔══██╗██║   ██║   ██║             ${DO}║${R}`,
    `${B}${DO}  ║      ${O}██████╔╝╚██████╔╝   ██║             ${DO}║${R}`,
    `${B}${DO}  ║      ${O}╚═════╝  ╚═════╝    ╚═╝             ${DO}║${R}`,
    `${B}${O}  ║                                           ║${R}`,
    `${B}${O}  ║  ${O2}Advanced WhatsApp Bot by FOXY TECH     ${O}║${R}`,
    `${B}${O}  ║  ${W}WhatsApp Multi-Device  ──  v1.1.6      ${O}║${R}`,
    `${B}${O}  ║                                           ║${R}`,
    `${B}${O}  ╚═══════════════════════════════════════════╝${R}`,
  ].join('\n') + '\n\n');
}

// === ENV LOADER ===
function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq !== -1) {
        const k = t.substring(0, eq).trim();
        const v = t.substring(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  } catch {}
}

// === CONFIG FETCHER ===
async function fetchRepoUrl() {
  let jsonData = '';
  try {
    step('📡', 'Fetching config', 'from JSON');
    jsonData = await nativeGetText(REPO_JSON_URL);

    // Try strict JSON first.
    try {
      const data = JSON.parse(jsonData);
      // Handle array format: [{ "repo": "url" }]
      if (Array.isArray(data) && data.length > 0 && data[0] && data[0].repo) {
        const url = data[0].repo;
        step('✅', 'Repo URL found', url);
        return url;
      }
      // Handle object format: { "repo": "url" }
      if (data && data.repo) {
        const url = data.repo;
        step('✅', 'Repo URL found', url);
        return url;
      }
    } catch (_) {
      // Fall through to tolerant regex extraction below — the remote
      // config file is sometimes malformed (e.g. `["repo":"url"]`
      // instead of valid JSON), so we don't want a syntax slip to
      // silently drop us back to the fallback repo.
    }

    const match = jsonData.match(/"repo"\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      const url = match[1];
      step('✅', 'Repo URL found', `${url} (recovered from malformed JSON)`);
      return url;
    }

    throw new Error('Invalid JSON structure: missing repo URL');
  } catch (error) {
    err(`Failed to fetch repo URL: ${error.message}`);
    warn('Using fallback GitHub URL');
    return 'https://github.com/WOLFTECH-254/FOXY/archive/refs/heads/main.zip';
  }
}

// === DOWNLOAD & EXTRACT ===
async function downloadAndExtract() {
  const _entryExists = ['index.js', 'main.js', 'bot.js', 'app.js']
    .some(f => fs.existsSync(path.join(EXTRACT_DIR, f)));

  if (fs.existsSync(EXTRACT_DIR) && _entryExists) {
    if (!fs.existsSync(path.join(EXTRACT_DIR, 'node_modules'))) {
      spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: EXTRACT_DIR, stdio: 'ignore' });
    }
    patchDotenv(EXTRACT_DIR);
    return;
  }

  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const zipPath = path.join(TEMP_DIR, 'bundle.zip');

  const repoUrl = await fetchRepoUrl();
  step('📥', 'Downloading', repoUrl);
  await nativeDownload(repoUrl, zipPath, { headers: { 'User-Agent': 'foxy-fetcher/1.0' } });

  const stat = fs.statSync(zipPath);
  if (stat.size < 1000) {
    const preview = fs.readFileSync(zipPath, 'utf8').slice(0, 300);
    throw new Error(`Download too small (${stat.size}B) — possibly a 404 or auth wall:\n${preview}`);
  }

  step('📦', 'Extracting', 'please wait...');
  try {
    extractZip(zipPath, TEMP_DIR);
  } finally {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }

  const items = fs.readdirSync(TEMP_DIR).filter(f =>
    fs.statSync(path.join(TEMP_DIR, f)).isDirectory() && f !== 'core'
  );
  if (items.length > 0) {
    fs.renameSync(path.join(TEMP_DIR, items[0]), EXTRACT_DIR);
  }

  if (!fs.existsSync(EXTRACT_DIR)) {
    throw new Error('Extraction completed but core directory was not found.');
  }

  step('🔧', 'Installing deps', 'npm install...');
  pinChalk4(EXTRACT_DIR);
  spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: EXTRACT_DIR, stdio: 'ignore' });
  patchDotenv(EXTRACT_DIR);
}

function pinChalk4(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    let changed = false;
    if (pkg.dependencies?.chalk)    { pkg.dependencies.chalk    = '^4.1.2'; changed = true; }
    if (pkg.devDependencies?.chalk) { pkg.devDependencies.chalk  = '^4.1.2'; changed = true; }
    if (changed) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  } catch {}
}

function patchChalk(nm) {
  const chalkDir  = path.join(nm, 'chalk');
  if (!fs.existsSync(chalkDir)) return;
  const pkgPath   = path.join(chalkDir, 'package.json');
  const indexPath = path.join(chalkDir, 'index.js');
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath, 'utf8');
    if (content.includes('export default') && content.includes('createChalk')) return;
    fs.unlinkSync(indexPath);
  }
  const shim = [
    "const C={reset:[0,0],bold:[1,22],dim:[2,22],italic:[3,23],underline:[4,24],",
    "strikethrough:[9,29],black:[30,39],red:[31,39],green:[32,39],yellow:[33,39],",
    "blue:[34,39],magenta:[35,39],cyan:[36,39],white:[37,39],gray:[90,39],grey:[90,39],",
    "bgBlack:[40,49],bgRed:[41,49],bgGreen:[42,49],bgYellow:[43,49],",
    "bgBlue:[44,49],bgMagenta:[45,49],bgCyan:[46,49],bgWhite:[47,49]};",
    "const w=(o,c,s)=>`\\x1b[${o}m${s}\\x1b[${c}m`;",
    "const createChalk=(stack=[])=>{",
    "  const fn=(...a)=>{let s=a.join(' ');for(const[o,c]of stack)s=w(o,c,s);return s;};",
    "  fn.level=3;",
    "  return new Proxy(fn,{get(_,p){if(p==='level')return 3;if(p in C)return createChalk([...stack,C[p]]);return undefined;}});",
    "};",
    "const chalk=createChalk();",
    "export default chalk;",
    "export {createChalk as Chalk};",
  ].join('\n');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.type = 'module';
    pkg.main = 'index.js';
    pkg.exports = { '.': { import: './index.js', default: './index.js' } };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
  } catch {}
  fs.writeFileSync(indexPath, shim);
}

function patchAxios(nm) {
  const axiosDir = path.join(nm, 'axios');
  if (!fs.existsSync(axiosDir)) return;
  const indexJs  = path.join(axiosDir, 'index.js');
  const indexMjs = path.join(axiosDir, 'index.mjs');
  if (fs.existsSync(indexJs)) {
    try { if (fs.readFileSync(indexJs, 'utf8').includes('doReq')) return; } catch {}
    try { fs.unlinkSync(indexJs); } catch {}
  }
  const cjsImpl = [
    "'use strict';",
    "const https=require('https'),http=require('http'),zlib=require('zlib');",
    "function doReq(cfg,rd){rd=rd||0;return new Promise((res,rej)=>{",
    "  let u=cfg.url||'';",
    "  if(cfg.baseURL&&!/^https?:/.test(u))u=cfg.baseURL.replace(/\\/$/,'')+'/'+u.replace(/^\\/+/,'');",
    "  let p;try{p=new URL(u);}catch(e){return rej(e);}",
    "  const mod=p.protocol==='https:'?https:http;",
    "  const hdrs=Object.assign({'user-agent':'axios/1.0','accept':'application/json,text/plain,*/*'},cfg.headers||{});",
    "  const body=cfg.data?(typeof cfg.data==='string'?cfg.data:JSON.stringify(cfg.data)):null;",
    "  if(body)hdrs['content-length']=Buffer.byteLength(body);",
    "  const opts={hostname:p.hostname,port:p.port||undefined,path:p.pathname+(p.search||''),method:(cfg.method||'GET').toUpperCase(),headers:hdrs};",
    "  const r=mod.request(opts,resp=>{",
    "    if([301,302,303,307,308].includes(resp.statusCode)&&resp.headers.location&&rd<10)",
    "      return doReq({...cfg,url:resp.headers.location},rd+1).then(res).catch(rej);",
    "    const enc=resp.headers['content-encoding']||'';",
    "    let s=resp;",
    "    if(enc.includes('gzip'))s=resp.pipe(zlib.createGunzip());",
    "    else if(enc.includes('deflate'))s=resp.pipe(zlib.createInflate());",
    "    const ch=[];s.on('data',c=>ch.push(c));",
    "    s.on('end',()=>{",
    "      const raw=Buffer.concat(ch).toString();",
    "      let data=raw;",
    "      if((resp.headers['content-type']||'').includes('json')){try{data=JSON.parse(raw);}catch{}}",
    "      const out={data,status:resp.statusCode,statusText:resp.statusMessage,headers:resp.headers,config:cfg};",
    "      if(resp.statusCode>=200&&resp.statusCode<300)res(out);",
    "      else{const e=new Error('Request failed with status code '+resp.statusCode);e.response=out;rej(e);}",
    "    });",
    "    s.on('error',rej);",
    "  });",
    "  if(cfg.timeout)r.setTimeout(cfg.timeout,()=>r.destroy(new Error('timeout')));",
    "  r.on('error',rej);if(body)r.write(body);r.end();",
    "});}",
    "const axios=cfg=>doReq(typeof cfg==='string'?{url:cfg,method:'GET'}:cfg);",
    "['get','delete','head','options'].forEach(m=>{axios[m]=(url,c)=>doReq({...(c||{}),url,method:m.toUpperCase()});});",
    "['post','put','patch'].forEach(m=>{axios[m]=(url,data,c)=>doReq({...(c||{}),url,data,method:m.toUpperCase()});});",
    "axios.create=(def={})=>{",
    "  const i=cfg=>doReq({...def,...(typeof cfg==='string'?{url:cfg}:(cfg||{}))});",
    "  ['get','delete','head','options'].forEach(m=>{i[m]=(url,c)=>doReq({...def,...(c||{}),url,method:m.toUpperCase()});});",
    "  ['post','put','patch'].forEach(m=>{i[m]=(url,data,c)=>doReq({...def,...(c||{}),url,data,method:m.toUpperCase()});});",
    "  i.defaults={...def};i.interceptors={request:{use:()=>{}},response:{use:()=>{}}};return i;",
    "};",
    "axios.defaults={headers:{common:{}}};",
    "axios.interceptors={request:{use:()=>{}},response:{use:()=>{}}};",
    "axios.isAxiosError=e=>!!(e&&e.response);",
    "axios.CanceledError=class CanceledError extends Error{};",
    "axios.CancelToken={source:()=>({token:null,cancel:()=>{}})};",
    "module.exports=axios;module.exports.default=axios;",
  ].join('\n');
  try { fs.writeFileSync(indexJs, cjsImpl); } catch {}
  try {
    fs.writeFileSync(indexMjs, "import _a from './index.js';\nexport default _a;\nexport const {create,get,post,put,patch,isAxiosError,defaults,interceptors,CanceledError,CancelToken}=_a;\n");
  } catch {}
  try {
    const pkgPath = path.join(axiosDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    delete pkg.type;
    pkg.main = 'index.js';
    pkg.exports = { '.': { import: './index.mjs', require: './index.js', default: './index.js' } };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
  } catch {}
}

function canOpen(p) {
  try { const fd = fs.openSync(p, 'r'); fs.closeSync(fd); return true; } catch { return false; }
}

function patchBaileys(nm) {
  const ALT_PATHS = [
    'lib/index.js','dist/index.js','src/index.js',
    'dist/node/index.js','lib/main.js','dist/main.js',
    'build/index.js','lib/src/index.js','index.js',
  ];
  const TMP_NM = '/tmp/bfx_mods/node_modules';

  const pkgMap = {};
  const dirs = [];
  try {
    for (const e of fs.readdirSync(nm)) {
      if (e.startsWith('@')) {
        try { for (const s of fs.readdirSync(path.join(nm, e))) dirs.push([path.join(nm, e, s), `${e}/${s}`]); } catch {}
      } else {
        dirs.push([path.join(nm, e), e]);
      }
    }
  } catch {}

  const needInstall = [];

  for (const [d, spec] of dirs) {
    try {
      const pkgPath = path.join(d, 'package.json');
      if (!canOpen(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const exp = pkg.exports;
      const emptyExports = exp != null && typeof exp === 'object' && !Array.isArray(exp) && Object.keys(exp).length === 0;
      const mainVal = pkg.main || 'index.js';
      const mainBroken = !canOpen(path.join(d, mainVal));
      if (!emptyExports && !mainBroken) continue;

      let found = false;
      for (const alt of ALT_PATHS) {
        const altAbs = path.join(d, alt);
        if (canOpen(altAbs)) {
          pkgMap[spec] = pathToFileURL(altAbs).href;
          found = true;
          break;
        }
      }
      if (!found) {
        const parts = spec.split('/');
        for (const alt of ALT_PATHS) {
          const tmpF = path.join(TMP_NM, ...parts, alt);
          if (canOpen(tmpF)) {
            pkgMap[spec] = pathToFileURL(tmpF).href;
            found = true;
            break;
          }
        }
      }
      if (!found) needInstall.push(spec);
    } catch {}
  }

  if (needInstall.length > 0) {
    try {
      fs.mkdirSync('/tmp/bfx_mods', { recursive: true });
      fs.mkdirSync('/tmp/bfx_npm_cache', { recursive: true });
      spawnSync('npm', [
        'install',
        '--prefix', '/tmp/bfx_mods',
        '--cache', '/tmp/bfx_npm_cache',
        '--no-audit', '--no-fund', '--ignore-scripts',
        '--prefer-dedupe',
        ...needInstall,
      ], {
        stdio: 'ignore',
        timeout: 120000,
        env: { ...process.env, npm_config_cache: '/tmp/bfx_npm_cache' },
      });
      for (const spec of needInstall) {
        const parts = spec.split('/');
        for (const alt of ALT_PATHS) {
          const f = path.join(TMP_NM, ...parts, alt);
          if (canOpen(f)) {
            pkgMap[spec] = pathToFileURL(f).href;
            break;
          }
        }
      }
    } catch {}
  }

  const FORCE_MAP = [
    ['@whiskeysockets/baileys', ['lib/index.js', 'dist/index.js', 'src/index.js', 'index.js']],
  ];
  for (const [spec, alts] of FORCE_MAP) {
    if (pkgMap[spec]) continue;
    const parts = spec.split('/');
    for (const alt of alts) {
      const f = path.join(nm, ...parts, alt);
      if (canOpen(f)) { pkgMap[spec] = pathToFileURL(f).href; break; }
    }
  }

  const hookSrc = [
    "import{pathToFileURL,fileURLToPath}from'node:url';",
    "import{existsSync}from'node:fs';",
    "import{dirname,join}from'node:path';",
    `const MAP=${JSON.stringify(pkgMap)};`,
    "function isSubpath(s){const p=s.split('/');return s.startsWith('@')?p.length>2:p.length>1;}",
    "function pkgParts(s){const p=s.split('/');return s.startsWith('@')?p.slice(0,2):p.slice(0,1);}",
    "const ALTS=['lib/index.js','dist/index.js','src/index.js','dist/node/index.js','lib/main.js','dist/main.js','build/index.js','index.js'];",
    "export async function resolve(s,c,n){",
    "  if(MAP[s])return{url:MAP[s],shortCircuit:true};",
    "  try{return await n(s,c);}catch(e){",
    "    if(e.code==='ERR_MODULE_NOT_FOUND'&&c.parentURL",
    "       &&!s.startsWith('.')&&!s.startsWith('/')&&!s.startsWith('node:')&&!s.startsWith('file:')&&!isSubpath(s)){",
    "      try{",
    "        const base=dirname(fileURLToPath(c.parentURL));",
    "        const parts=pkgParts(s);",
    "        for(const a of ALTS){",
    "          const f=join(base,'node_modules',...parts,a);",
    "          if(existsSync(f))return{url:pathToFileURL(f).href,shortCircuit:true};",
    "        }",
    "      }catch{}",
    "    }",
    "    throw e;",
    "  }",
    "}",
  ].join('\n');

  const preloadSrc = [
    "import{register}from'node:module';",
    "import{pathToFileURL}from'node:url';",
    "register(pathToFileURL('/tmp/_bfx_hook.mjs'));",
  ].join('\n');

  try { fs.writeFileSync('/tmp/_bfx_hook.mjs', hookSrc); } catch {}
  try { fs.writeFileSync('/tmp/_bfx_preload.mjs', preloadSrc); } catch {}
}

function patchLegacyMains(nm) {
  const ALT_PATHS = [
    'lib/index.js','dist/index.js','src/index.js',
    'dist/node/index.js','lib/src/index.js','build/index.js',
  ];
  let dirs = [];
  try {
    for (const e of fs.readdirSync(nm)) {
      if (e.startsWith('@')) {
        try { for (const s of fs.readdirSync(path.join(nm, e))) dirs.push(path.join(nm, e, s)); } catch {}
      } else {
        dirs.push(path.join(nm, e));
      }
    }
  } catch {}
  for (const d of dirs) {
    try {
      const pkgPath = path.join(d, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const mainVal = pkg.main || 'index.js';
      if (!/index\.(js|cjs)$/.test(mainVal)) continue;
      const mainAbs = path.join(d, mainVal);
      if (fs.existsSync(mainAbs)) continue;
      for (const alt of ALT_PATHS) {
        const altAbs = path.join(d, alt);
        if (fs.existsSync(altAbs)) {
          try {
            fs.writeFileSync(mainAbs, `'use strict';\nconst m=require('./${alt}');\nmodule.exports=m;\nmodule.exports.default=m.default||m;\n`);
            const p2 = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            delete p2.type;
            p2.main = mainVal;
            fs.writeFileSync(pkgPath, JSON.stringify(p2));
          } catch {}
          break;
        }
      }
    } catch {}
  }
}

function fixBaileys(nm) {
  const baileysDir = path.join(nm, '@whiskeysockets', 'baileys');
  if (!fs.existsSync(baileysDir)) return;

  const pkgPath    = path.join(baileysDir, 'package.json');
  const indexPath  = path.join(baileysDir, 'index.js');
  const libIndex   = path.join(baileysDir, 'lib', 'index.js');
  const distIndex  = path.join(baileysDir, 'dist', 'index.js');

  const realEntry = fs.existsSync(libIndex)  ? './lib/index.js'
                  : fs.existsSync(distIndex) ? './dist/index.js'
                  : null;
  if (!realEntry) return;

  if (!fs.existsSync(indexPath)) {
    try {
      fs.writeFileSync(indexPath, `export * from '${realEntry}';\n`);
    } catch {}
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.main    = 'index.js';
    pkg.exports = {
      '.': { import: './index.js', require: './index.js', default: './index.js' },
      './lib/*': { import: './lib/*', default: './lib/*' },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
  } catch {}
}

function patchDotenv(dir) {
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) {
    spawnSync('npm', ['install', '--no-audit'], { cwd: dir, stdio: 'ignore' });
  }
  fixBaileys(nm);
  patchChalk(nm);
  patchAxios(nm);
  patchBaileys(nm);
  patchLegacyMains(nm);
  const dotenvDir = path.join(nm, 'dotenv');
  const idx = path.join(dotenvDir, 'index.js');
  if (fs.existsSync(idx)) return;
  fs.mkdirSync(dotenvDir, { recursive: true });
  fs.writeFileSync(path.join(dotenvDir, 'package.json'), '{"name":"dotenv","version":"16.0.0","main":"index.js"}');
  fs.writeFileSync(idx, [
    "'use strict';",
    "const _fs=require('fs'),_p=require('path');",
    "function config(o){",
    "  try{",
    "    const f=(o&&o.path)||_p.join(process.cwd(),'.env');",
    "    if(!_fs.existsSync(f))return{parsed:{}};",
    "    const parsed={};",
    "    const lines=_fs.readFileSync(f,'utf8').split('\\n');",
    "    for(const l of lines){",
    "      const m=l.match(/^\\s*([^#=\\s][^=]*)\\s*=\\s*([\\s\\S]*)$/);",
    "      if(m){",
    "        const k=m[1].trim();",
    "        const v=m[2].trim().replace(/^['\"]|['\"]$/g,'');",
    "        parsed[k]=v;",
    "        if(!process.env[k])process.env[k]=v;",
    "      }",
    "    }",
    "    return{parsed};",
    "  }catch(e){return{parsed:{}};}",
    "}",
    "module.exports={config};",
    "module.exports.default=module.exports;"
  ].join('\n'));
}

// === SETTINGS SYNC ===
async function applyLocalSettings() {
  if (!fs.existsSync(LOCAL_SETTINGS)) return;
  try {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    fs.copyFileSync(LOCAL_SETTINGS, EXTRACTED_SETTINGS);
  } catch {}
}

// === BOT LAUNCHER ===
function startBot() {
  let botDir = fs.existsSync(EXTRACT_DIR) ? EXTRACT_DIR : null;

  if (!botDir) {
    for (const dir of [
      path.join(__dirname, 'core'),
      path.join(__dirname, 'bot'),
      path.join(__dirname, 'src')
    ]) {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.js'))) {
        botDir = dir;
        break;
      }
    }
  }

  if (!botDir) {
    err('No bot directory found — download may have failed.');
    err('Place bot files in a "core" folder and retry.');
    process.exit(1);
  }

  let mainFile = 'index.js';
  for (const file of ['index.js', 'main.js', 'bot.js', 'app.js']) {
    if (fs.existsSync(path.join(botDir, file))) { mainFile = file; break; }
  }

  showLiveBanner();

  const _preloadOk = fs.existsSync('/tmp/_bfx_preload.mjs');
  const nodeArgs = _preloadOk
    ? ['--import', 'file:///tmp/_bfx_preload.mjs', mainFile]
    : [mainFile];
  const _env = { ...process.env };
  if (_preloadOk) {
    const _prev = (_env.NODE_OPTIONS || '').replace(/--import\s+file:\/\/\/tmp\/_bfx_preload\.mjs/g, '').trim();
    _env.NODE_OPTIONS = (`${_prev} --import file:///tmp/_bfx_preload.mjs`).trim();
  }

  const bot = spawn('node', nodeArgs, {
    cwd:   botDir,
    stdio: 'inherit',
    env:   _env,
  });

  bot.on('close', (code) => {
    if (code !== 0 && code !== null) {
      warn(`Bot exited (code ${code}). Restarting in 3s...`);
      setTimeout(() => startBot(), 3000);
    }
  });

  bot.on('error', (e) => {
    err(`Failed to start: ${e.message}`);
    setTimeout(() => startBot(), 3000);
  });
}

// === ENTRY POINT ===
(async () => {
  loadEnvFile();
  try {
    await downloadAndExtract();
    await applyLocalSettings();
  } catch (e) {
    err(`Setup failed: ${e.message}`);
    warn('Setup failed — attempting to start from existing files...');
  }
  startBot();
})();
