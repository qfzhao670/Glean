import os
import sys
from pathlib import Path
import tempfile

os.environ['GLEAN_DATA_DIR'] = tempfile.mkdtemp(prefix='glean-test-session-')
os.environ['GLEAN_TOKEN'] = 'test-session-token'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi.testclient import TestClient
from glean import store
from glean.app import app

@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path / 'data')
    store.DATA.mkdir()
    store.init()

@pytest.fixture
def client():
    with TestClient(app, headers={'X-Glean-Token': 'test-session-token'}) as value:
        yield value
