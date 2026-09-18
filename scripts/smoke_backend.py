"""Smoke-test the frozen sidecar in isolation, using no external service."""
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

root = Path(__file__).resolve().parents[1]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='glean-packaged-smoke-') as folder:
    env = {**os.environ, 'GLEAN_DATA_DIR': folder, 'GLEAN_UI_DIR': str(root / 'dist'), 'GLEAN_PORT': str(port), 'GLEAN_TOKEN': 'isolated-smoke-token'}
    process = subprocess.Popen([str(root / 'dist/glean-backend/glean-backend')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', headers={'X-Glean-Token': env['GLEAN_TOKEN']}, trust_env=False) as client:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError(process.communicate()[1].decode())
                try:
                    if client.get('/api/health').status_code == 200:
                        break
                except httpx.ConnectError:
                    time.sleep(.15)
            else:
                raise RuntimeError('Frozen backend startup timed out')
            assert client.get('/api/stats').json()['notes'] == 0
            assert client.get('/api/settings').json()['api_key'] == ''
            assert 'root' in client.get('/').text
            assert client.get('/api/notes', headers={'X-Glean-Token': 'invalid'}).status_code == 401
            print('Frozen sidecar smoke test passed: startup, UI, database, settings, auth.')
    finally:
        process.kill()
        process.wait()
