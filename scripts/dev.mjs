import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const token = randomBytes(32).toString('hex');
const env = { ...process.env, GLEAN_TOKEN: token, GLEAN_PORT: '8765', VITE_GLEAN_TOKEN: token };
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const backend = spawn(python, ['backend/entry.py'], { env, stdio: 'inherit' });
const ui = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:ui'], { env, stdio: 'inherit' });
let stopping = false;
function stop() { if (stopping) return; stopping = true; backend.kill(); ui.kill(); }
for (const child of [backend, ui]) { child.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; }); child.on('exit', stop); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
