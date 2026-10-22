const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { killTree } = require('../backend/utils/processes');
const root = path.resolve(__dirname, '..');
const development = process.argv.includes('--dev');
const executableArgument = process.argv.slice(2).find((value) => !value.startsWith('--'));
const executable = development ? require('electron') : executableArgument ? path.resolve(executableArgument) : path.join(root, 'release', 'win-unpacked', 'GSD.exe');
const work = path.join(root, 'work', `desktop-smoke-${Date.now()}`);
const report = path.join(work, 'result.json');

async function main() {
  await fs.access(executable);
  await fs.mkdir(work, { recursive: true });
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' };
  // Shells which embed Node sometimes export this; GSD must run as Electron.
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [`--smoke-test=${report}`, `--gsd-user-data=${path.join(work, 'user-data')}`, '--enable-logging=stderr'];
  if (process.argv.includes('--capture')) args.push('--smoke-capture');
  if (development) args.unshift(root);
  const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let logs = '';
  child.stdout.on('data', (data) => { logs = (logs + data).slice(-16_000); });
  child.stderr.on('data', (data) => { logs = (logs + data).slice(-16_000); });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void killTree(child); }, 180_000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timeout);
  await fs.writeFile(path.join(work, 'process.log'), logs);
  if (timedOut) throw new Error(`Desktop smoke test exceeded 180 seconds. Its process tree was stopped. Logs: ${path.join(work, 'process.log')}`);
  let result;
  try { result = JSON.parse(await fs.readFile(report, 'utf8')); }
  catch { throw new Error(`Desktop smoke test produced no result (exit ${code}). ${logs}`); }
  console.log(JSON.stringify({ ...result, report }, null, 2));
  if (code !== 0 || !result.ok) throw new Error(`Desktop smoke test failed (exit ${code}). ${result.error || logs}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
