"""Start a real loopback server with isolated settings, then stop only that process."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

import httpx


def main():
    root = Path(__file__).resolve().parents[1]
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    token = secrets.token_hex(32)
    env = {**os.environ, 'PYTHON_DOTENV_DISABLED': '1', 'OPENAI_API_KEY': '', 'NVIDIA_API_KEY': '',
           'AI_MODEL': '', 'APP_ENV': 'development', 'API_ACCESS_TOKEN': token,
           'API_ALLOWED_HOSTS': '127.0.0.1', 'API_ALLOWED_ORIGINS': 'http://localhost:5173',
           'API_RATE_LIMIT_PER_CLIENT': '60', 'API_RATE_LIMIT_GLOBAL': '300', 'API_RATE_LIMIT_WINDOW_SECONDS': '60'}
    process = subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--host', '127.0.0.1',
         '--port', str(port), '--no-proxy-headers', '--no-access-log'],
        cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
    )
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', trust_env=False, timeout=2) as client:
            deadline = time.monotonic() + 15
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Isolated smoke server exited during startup')
                try:
                    response = client.get('/health')
                    assert response.status_code == 200 and response.json()['service'] == 'ai-sana-taskrank'
                    break
                except httpx.ConnectError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Isolated smoke server startup timed out') from None
                    time.sleep(0.1)
            assert client.get('/api/ai/inspector').status_code == 401
            headers = {'Authorization': f'Bearer {token}', 'Origin': 'http://localhost:5173'}
            result = client.post('/api/ai/generate-card', headers=headers, json={'draft': 'Нужен бот для заказов'})
            assert result.status_code == 200
            assert result.json()['confirmed'] is False
            assert result.headers['cache-control'] == 'no-store'
            assert result.headers['access-control-allow-origin'] == 'http://localhost:5173'
            denied = client.post('/api/ai/analyze', headers=headers, json={'draft': 'Реши мне уравнение x+1=2'})
            assert denied.status_code == 422 and denied.json()['detail']['code'] == 'OFF_TOPIC'
            bad_json = client.post('/api/ai/analyze', headers={**headers, 'Content-Type': 'application/json'},
                                   content=b'{"draft":"one","draft":"two"}')
            assert bad_json.status_code == 400
        print('Live loopback smoke passed: startup, auth, CORS, offline card, scope refusal, strict JSON.')
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        if process.stderr:
            process.stderr.close()


if __name__ == '__main__':
    main()
