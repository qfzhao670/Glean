from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs
from pathlib import Path
all_data, all_bins, all_hidden = [], [], []
for package in ['imageio_ffmpeg', 'uvicorn', 'huggingface_hub', 'tiktoken']:
    data, binaries, hidden = collect_all(package)
    all_data += data
    all_bins += binaries
    all_hidden += hidden
all_data += collect_data_files('mlx_whisper')
all_data += collect_data_files('mlx')
all_bins += collect_dynamic_libs('mlx')
all_hidden += [
    'mlx.__array_api_info', 'mlx._reprlib_fix', 'mlx.utils', 'mlx.nn',
    'mlx_whisper', 'mlx_whisper.audio', 'mlx_whisper.decoding', 'mlx_whisper.load_models',
    'mlx_whisper.tokenizer', 'mlx_whisper.transcribe',
    'mlx_whisper.version', 'mlx_whisper.whisper', 'mlx_whisper.writers',
]
a = Analysis([str(Path(SPECPATH) / 'entry.py')], pathex=[SPECPATH], binaries=all_bins, datas=all_data,
             hiddenimports=all_hidden, excludes=['torch', 'torchgen', 'mlx_whisper.timing', 'scipy', 'numba', 'llvmlite'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='glean-backend', console=False)
coll = COLLECT(exe, a.binaries, a.datas, name='glean-backend')
