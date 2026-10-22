const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('../backend/server');

async function main() {
  const port = Number(process.env.PORT || 3000);
  const backend = await startServer({ host: '127.0.0.1', port });
  console.log(`GSD API: ${backend.url}`);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const frontend = spawn(process.execPath, [vite, '--host', '127.0.0.1'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, GSD_API_URL: backend.url } });
  let closing = false;
  async function close(code = 0) {
    if (closing) return;
    closing = true;
    frontend.kill();
    await backend.close();
    process.exitCode = code;
  }
  frontend.on('exit', (code) => { void close(code || 0); });
  frontend.on('error', (error) => { console.error(error); void close(1); });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
