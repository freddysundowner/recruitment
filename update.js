#!/usr/bin/env node
'use strict';
/*
 * Updates an installed recruitment system from a folder (or .tar.gz / .zip) of the new files.
 *
 *   sudo recruit-update /path/to/new-files            (the installer sets up this command)
 *   sudo recruit-update /path/to/new-files.tar.gz
 *   sudo node /opt/recruit/update.js /path/to/new-files
 *
 * What it does, in order, so a bad update never leaves you down:
 *   1. shows what will change and asks before doing anything
 *   2. backs up the database
 *   3. builds the new version NEXT TO the running one (the website stays up while it builds)
 *   4. stops the services, updates the database tables, swaps in the new version, starts again (about half a minute)
 *   5. checks the website answers; if it does not, puts the old version back, and the old data if it has to
 * Your settings (/etc/recruit/*.env), your documents and your database are never replaced by an update.
 *
 * Options:  --instance NAME   which install, when there is more than one on the server
 *           --check           only show what would change
 *           --yes             do not ask
 *           --no-backup       skip the database backup (not advised)
 *           --keep N          how many old versions to keep for a quick rollback (default 2)
 *           --rollback        go back to the previous version (and its data backup if you say so)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const readline = require('readline');

const LOG = '/var/log/recruit-update.log';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--instance', '--keep'].includes(args[i - 1])));
const YES = flag('--yes') || flag('-y');
const KEEP = Math.max(1, parseInt(opt('--keep', '2'), 10) || 2);

const color = (c, s) => (process.stdout.isTTY ? '\x1b[' + c + 'm' + s + '\x1b[0m' : s);
let stepN = 0;
const step = (s) => { stepN += 1; console.log('\n' + color('1', stepN + '. ' + s)); log('STEP ' + s); };
const say = (s) => { console.log('   ' + s); log(s); };
const ok = (s) => { console.log('   ' + color('32', '\u2713') + ' ' + s); log('OK ' + s); };
const warn = (s) => { console.log('   ' + color('33', '!') + ' ' + s); log('WARN ' + s); };
function log(s) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + s + '\n'); } catch (e) { /* the log is a convenience */ } }
function die(s) { console.error('\n' + color('31', 'Problem: ') + s); log('FAILED ' + s); process.exit(1); }

function run(cmd, argv, o) {
  o = o || {};
  const r = cp.spawnSync(cmd, argv, { encoding: 'utf8', cwd: o.cwd, env: Object.assign({}, process.env, o.env || {}), maxBuffer: 1 << 28 });
  log('$ ' + cmd + ' ' + argv.join(' ').replace(/(:\/\/[^:]+:)[^@]+@/g, '$1***@') + ' -> ' + r.status);
  if (r.stdout) log(r.stdout.slice(-4000));
  if (r.stderr) log(r.stderr.slice(-4000));
  if (r.status !== 0 && !o.soft) { const e = new Error(cmd + ' failed' + (r.stderr ? ': ' + r.stderr.trim().split('\n').slice(-3).join(' | ') : '')); e.result = r; throw e; }
  return r;
}
function ask(q, def) {
  if (YES || !process.stdin.isTTY) return Promise.resolve(def);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('   ' + q + ' ', (a) => { rl.close(); res(a.trim() || def); }));
}
const yes = async (q, def) => /^y/i.test(await ask(q + (def === 'y' ? ' [Y/n]' : ' [y/N]'), def));

function readEnv(file) {
  const out = {};
  fs.readFileSync(file, 'utf8').split('\n').forEach((l) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (!m) return;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    out[m[1]] = v;
  });
  return out;
}
const exists = (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

function findInstance() {
  const dir = '/etc/recruit';
  const files = exists(dir) ? fs.readdirSync(dir).filter((f) => /\.env$/.test(f)) : [];
  if (!files.length) die('No installed system found (nothing in /etc/recruit). Run the installer first.');
  const want = opt('--instance', null);
  let name;
  if (want) { name = want.replace(/\.env$/, ''); if (!files.includes(name + '.env')) die('There is no install called "' + name + '". Found: ' + files.map((f) => f.replace(/\.env$/, '')).join(', ')); }
  else if (files.length === 1) name = files[0].replace(/\.env$/, '');
  else die('There is more than one install here. Choose with --instance NAME. Found: ' + files.map((f) => f.replace(/\.env$/, '')).join(', '));
  return name;
}

function resolveSource() {
  let src = positional[0];
  if (!src) die('Tell me where the new files are:  recruit-update /path/to/new-files   (a folder, or a .tar.gz or .zip)');
  src = path.resolve(src);
  if (!exists(src)) die(src + ' does not exist.');
  let tmp = null;
  if (fs.statSync(src).isFile()) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recruit-update-'));
    if (/\.(tar\.gz|tgz)$/i.test(src)) run('tar', ['-xzf', src, '-C', tmp]);
    else if (/\.zip$/i.test(src)) run('unzip', ['-q', src, '-d', tmp]);
    else die('I can read a folder, a .tar.gz or a .zip.');
    let root = tmp;
    for (let i = 0; i < 3 && !exists(path.join(root, 'package.json')); i++) {
      const kids = fs.readdirSync(root).filter((k) => fs.statSync(path.join(root, k)).isDirectory() && k !== '__MACOSX');
      if (kids.length !== 1) break;
      root = path.join(root, kids[0]);
    }
    src = root;
  }
  return { src: src, tmp: tmp };
}

function health(port, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const r = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', 'http://127.0.0.1:' + port + '/login'], { soft: true });
    if (r.stdout.trim() === '200') return true;
    cp.spawnSync('sleep', ['2']);
  }
  return false;
}

(async function main() {
  if (flag('--help') || flag('-h')) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, '')); return; }
  if (process.getuid && process.getuid() !== 0) die('Run this as root: sudo recruit-update ...');
  const instance = findInstance();
  const envFile = '/etc/recruit/' + instance + '.env';
  const env = readEnv(envFile);
  const instDir = path.dirname(env.STORAGE_DIR || '');
  const root = path.dirname(instDir);
  const appDir = path.join(instDir, 'app');
  const nodeBin = path.join(root, 'node', 'current', 'bin');
  const web = 'recruit-' + instance + '-web', worker = 'recruit-' + instance + '-worker';
  const port = env.PORT || '3100';
  const user = 'recruit';
  const systemd = exists('/run/systemd/system');
  if (!exists(appDir)) die('The install at ' + appDir + ' is missing.');
  console.log(color('1', 'Updating ' + instance));

  // ---- rollback only
  if (flag('--rollback')) {
    const prevs = fs.readdirSync(instDir).filter((d) => /^app\.prev-/.test(d)).sort();
    if (!prevs.length) die('There is no previous version kept to go back to.');
    const prev = path.join(instDir, prevs[prevs.length - 1]);
    if (!(await yes('Go back to ' + prevs[prevs.length - 1] + '? The current version is kept as app.rolled-back.', 'n'))) return;
    if (systemd) run('systemctl', ['stop', web, worker], { soft: true });
    fs.renameSync(appDir, path.join(instDir, 'app.rolled-back-' + stamp()));
    fs.renameSync(prev, appDir);
    if (systemd) run('systemctl', ['start', web, worker], { soft: true });
    ok('Back on the previous version. The database was not changed. To restore the data too, use a backup from /var/backups/recruit/' + instance + ' with pg_restore.');
    return;
  }

  const sourceInfo = resolveSource();
  const src = sourceInfo.src;
  const cleanup = () => { if (sourceInfo.tmp) fs.rmSync(sourceInfo.tmp, { recursive: true, force: true }); };

  step('Looking at the new files');
  if (!exists(path.join(src, 'package.json')) || !exists(path.join(src, 'db', 'migrations'))) die(src + ' does not look like the recruitment system (no package.json and db/migrations).');
  const cur = readJson(path.join(appDir, 'package.json'));
  const next = readJson(path.join(src, 'package.json'));
  if (cur.name !== next.name) die('These files are for "' + next.name + '", but this install is "' + cur.name + '".');
  const curMig = fs.readdirSync(path.join(appDir, 'db', 'migrations')).filter((f) => /\.sql$/.test(f));
  const newMig = fs.readdirSync(path.join(src, 'db', 'migrations')).filter((f) => /\.sql$/.test(f));
  const fresh = newMig.filter((f) => curMig.indexOf(f) < 0).sort();
  const dropped = curMig.filter((f) => newMig.indexOf(f) < 0);
  if (dropped.length) die('The new files are missing database updates this install already has (' + dropped.join(', ') + '). These look older than what is installed.');
  say('Installed: ' + cur.version + '   New: ' + next.version);
  say('Database updates to apply: ' + (fresh.length ? fresh.join(', ') : 'none'));
  const needMajor = (exists(path.join(src, 'deploy', 'node-version')) ? fs.readFileSync(path.join(src, 'deploy', 'node-version'), 'utf8').trim() : '');
  const haveMajor = exists(path.join(nodeBin, 'node')) ? run(path.join(nodeBin, 'node'), ['-p', 'process.versions.node.split(".")[0]']).stdout.trim() : '';
  if (needMajor && needMajor !== haveMajor) say('Node.js: ' + haveMajor + ' -> ' + needMajor + ' (a private copy is installed; the server\'s own Node is not touched)');
  const free = parseInt(run('df', ['-Pm', instDir]).stdout.split('\n')[1].split(/\s+/)[3], 10);
  if (free < 2500) die('Only ' + free + ' MB free. An update needs about 2.5 GB to build next to the running version.');
  if (flag('--check')) { ok('Nothing was changed (--check).'); cleanup(); return; }
  if (!(await yes('Update now?', 'y'))) { cleanup(); return; }

  const ts = stamp();
  const newDir = path.join(instDir, 'app.new-' + ts);
  const prevDir = path.join(instDir, 'app.prev-' + ts);
  const backupDir = '/var/backups/recruit/' + instance;
  let dump = null, migrated = false, swapped = false;

  const startAll = () => { if (systemd) run('systemctl', ['start', web, worker], { soft: true }); };
  const stopAll = () => { if (systemd) run('systemctl', ['stop', web, worker], { soft: true }); };
  const asService = (argv, extra) => run('runuser', ['-u', user, '--', 'bash', '-c',
    'cd "$1"; shift; set -a; . "$0"; set +a; export PATH="' + nodeBin + ':$PATH" HOME="' + instDir + '/.home"; exec "$@"', envFile, extra.cwd].concat(argv));

  try {
    if (!flag('--no-backup')) {
      step('Backing up the database');
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      dump = path.join(backupDir, 'pre-update-' + ts + '.dump');
      run('pg_dump', ['--format=custom', '--dbname=' + env.MIGRATE_DATABASE_URL, '--file=' + dump]);
      ok('Saved ' + dump + ' (' + Math.round(fs.statSync(dump).size / 1024) + ' KB)');
    }

    if (needMajor && needMajor !== haveMajor) {
      step('Installing Node.js ' + needMajor + ' for this system');
      run('bash', [path.join(src, 'deploy', 'ensure-node.sh'), needMajor], { env: { RECRUIT_ROOT: root } });
      ok('Done');
    }

    step('Building the new version next to the running one (the website stays up)');
    fs.mkdirSync(newDir, { recursive: true });
    run('bash', ['-c', 'tar -C "$1" --exclude=./node_modules --exclude=./.next --exclude=./.next-dev --exclude=./.git --exclude="./.env*" --exclude=./storage --exclude=./backups --exclude=./e2e --exclude=./tests --exclude="*.log" --exclude=./tsconfig.tsbuildinfo -cf - . | tar -C "$2" -xf -', 'x', src, newDir]);
    run('chown', ['-R', user + ':' + user, newDir]);
    say('Installing packages ...');
    asService(['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: newDir });
    say('Building ...');
    asService(['env', 'TENANT_MODE=', 'LICENSE_PUBLIC_KEY=', 'DATABASE_URL=postgres://build:build@localhost:5432/build', 'SESSION_SECRET=build-time-placeholder-build-time-placeholder', 'npm', 'run', 'build'], { cwd: newDir });
    ok('Built');

    step('Switching over (a short pause while the services restart)');
    stopAll();
    say('Updating the database tables ...');
    asService(['npm', 'run', 'migrate'], { cwd: newDir });
    migrated = fresh.length > 0;
    fs.renameSync(appDir, prevDir);
    fs.renameSync(newDir, appDir);
    swapped = true;
    startAll();
    ok('New version started');

    step('Checking that it works');
    if (systemd) {
      if (!health(port, 90)) throw new Error('The website did not answer after the update.');
      ok('The website answers');
      const w = run('systemctl', ['is-active', worker], { soft: true });
      if (w.stdout.trim() !== 'active') warn('The worker is not running: journalctl -u ' + worker + ' -n 50');
    } else warn('No systemd here, so the services were not restarted. Start them yourself.');

    fs.writeFileSync(path.join(instDir, 'VERSION'), JSON.stringify({ version: next.version, updatedAt: new Date().toISOString(), from: cur.version, backup: dump }, null, 2) + '\n');
    for (const f of ['update.js']) { try { fs.copyFileSync(path.join(src, f), path.join(root, f)); } catch (e) { /* optional */ } }
    try { fs.copyFileSync(path.join(src, 'deploy', 'backup.sh'), path.join(root, 'backup.sh')); fs.chmodSync(path.join(root, 'backup.sh'), 0o755); } catch (e) { /* optional */ }
    const olds = fs.readdirSync(instDir).filter((d) => /^app\.(prev|rolled-back)-/.test(d)).sort();
    olds.slice(0, Math.max(0, olds.length - KEEP)).forEach((d) => fs.rmSync(path.join(instDir, d), { recursive: true, force: true }));
    cleanup();
    console.log('\n' + color('32;1', 'Updated to ' + next.version + '.') + ' The previous version is kept for a quick rollback:  sudo recruit-update --rollback');
    if (dump) say('The database backup from just before the update: ' + dump);
  } catch (e) {
    console.error('\n' + color('31', 'The update did not work: ') + e.message);
    log('ERROR ' + (e.stack || e.message));
    step('Putting the old version back');
    try {
      stopAll();
      if (swapped) { fs.renameSync(appDir, path.join(instDir, 'app.failed-' + ts)); fs.renameSync(prevDir, appDir); }
      startAll();
      let up = systemd ? health(port, 60) : true;
      if (!up && dump && migrated) {
        warn('The old version does not run on the updated database, so the data is being put back from the backup taken a moment ago.');
        stopAll();
        run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname=' + env.MIGRATE_DATABASE_URL, dump], { soft: true });
        startAll();
        up = health(port, 60);
      }
      if (up) ok('The old version is running again. Nothing was lost.');
      else warn('The old version is not answering either. Look at: journalctl -u ' + web + ' -n 80   and ' + LOG);
    } catch (e2) { warn('Could not put everything back automatically: ' + e2.message + '. The old files are in ' + instDir + ' (app.prev-*). Backup: ' + (dump || 'none')); }
    try { fs.rmSync(newDir, { recursive: true, force: true }); } catch (e3) { /* already gone */ }
    cleanup();
    process.exit(1);
  }
})();
