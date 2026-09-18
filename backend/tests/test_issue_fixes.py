from glean import store


def test_reveal_only_requested_secret_requires_local_auth_and_never_caches(client):
    store.save_settings({'api_key': 'fixture-text-key', 'transcription_key': 'fixture-speech-key'})
    url = '/api/settings/secrets/api_key/reveal'
    assert client.post(url, headers={'X-Glean-Token': 'wrong'}).status_code == 401
    assert client.post(url, headers={'Origin': 'https://attacker.example'}).status_code == 403
    assert client.post('/api/settings/secrets/vault_path/reveal').status_code == 422
    response = client.post(url)
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.json() == {'value': 'fixture-text-key'}
    assert client.post('/api/settings/secrets/transcription_key/reveal').json() == {'value': 'fixture-speech-key'}
    assert 'fixture-' not in client.get('/api/settings').text
    store.save_settings({'api_key': None})
    assert client.post(url).json() == {'value': ''}
