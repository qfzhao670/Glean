from PyInstaller.utils.hooks import collect_all
from pathlib import Path
all_data, all_bins, all_hidden = [], [], []
for package in ['yt_dlp', 'yt_dlp_ejs', 'imageio_ffmpeg', 'uvicorn']:
    data, binaries, hidden = collect_all(package)
    all_data += data
    all_bins += binaries
    all_hidden += hidden
a = Analysis([str(Path(SPECPATH) / 'entry.py')], pathex=[SPECPATH], binaries=all_bins, datas=all_data, hiddenimports=all_hidden)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='glean-backend', console=False)
coll = COLLECT(exe, a.binaries, a.datas, name='glean-backend')
