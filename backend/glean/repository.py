"""Markdown persistence, independent of any external notes application."""
from __future__ import annotations

import os
import re
import errno
import shutil
import tempfile
from pathlib import Path

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


def root(path):
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise ValueError('笔记仓库需要使用绝对路径。')
    if not target.is_dir():
        raise ValueError('笔记仓库目录不存在，请重新选择。')
    return target.resolve()


def write(folder, title, content, current='', expected=None):
    """Only update managed files whose on-disk content still matches our version."""
    folder = root(folder)
    try:
        if current:
            target = Path(current)
            if target.is_symlink() or not target.resolve().is_relative_to(folder):
                raise ValueError('笔记文件已移出当前仓库，请检查保存位置。')
            if target.exists() and target.read_text(encoding='utf-8') != expected:
                raise ValueError('仓库文件已被其他程序修改，本次未覆盖。请先导入外部版本，或选择另一个仓库保存。')
            descriptor, temporary = tempfile.mkstemp(prefix='.glean-', suffix='.tmp', dir=target.parent)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                    output.write(content)
                os.replace(temporary, target)
            finally:
                Path(temporary).unlink(missing_ok=True)
            return str(target)
        filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', title).strip('. ')[:80] or '未命名笔记'
        descriptor, temporary = tempfile.mkstemp(prefix='.glean-', suffix='.tmp', dir=folder)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                output.write(content)
            for index in range(10000):
                target = folder / (filename + (f' ({index + 1})' if index else '') + '.md')
                try:
                    # Publish only complete files; link is atomic and refuses to
                    # replace existing files or symlinks, even in a naming race.
                    try:
                        os.link(temporary, target)
                    except OSError as exc:
                        if exc.errno not in (errno.EPERM, errno.ENOTSUP, errno.EXDEV, errno.ENOSYS):
                            raise
                        # Some removable/network filesystems have no hard links.
                        # Exclusive creation still protects existing user files.
                        output = target.open('xb')
                        try:
                            with output, open(temporary, 'rb') as source:
                                    shutil.copyfileobj(source, output)
                        except OSError:
                            target.unlink(missing_ok=True)
                            raise
                    return str(target)
                except FileExistsError:
                    continue
            raise ValueError('同名笔记过多，请调整标题。')
        finally:
            Path(temporary).unlink(missing_ok=True)
    except (OSError, UnicodeError) as exc:
        raise ValueError(f'无法保存到笔记仓库 {folder}，请检查文件夹权限和磁盘空间。') from exc


def remove(folder, current, expected):
    """Remove only the managed Markdown file and refuse external changes."""
    if not current:
        return
    folder = root(folder)
    target = Path(current)
    try:
        if target.is_symlink() or not target.resolve().is_relative_to(folder):
            raise ValueError('笔记文件已移出当前仓库，请检查保存位置。')
        if not target.exists():
            return
        if target.read_text(encoding='utf-8') != expected:
            raise ValueError('仓库文件已被外部程序修改，本次未删除。请先备份或导入外部版本。')
        target.unlink()
    except (OSError, UnicodeError) as exc:
        raise ValueError(f'无法从笔记仓库 {folder} 删除文件，请检查文件夹权限。') from exc


def _asset_path(folder, note_id, filename):
    folder = root(folder)
    if not re.fullmatch(r'[0-9a-f]{32}', note_id) or not re.fullmatch(r'[0-9a-f]{32}\.(?:png|jpe?g|gif|webp)', filename):
        raise ValueError('图片路径无效。')
    asset_root = folder / 'assets'
    if asset_root.is_symlink() or (asset_root.exists() and not asset_root.resolve().is_relative_to(folder)):
        raise ValueError('图片目录已移出当前仓库。')
    directory = asset_root / note_id
    target = directory / filename
    if directory.is_symlink() or (directory.exists() and not directory.resolve().is_relative_to(folder)):
        raise ValueError('图片目录已移出当前仓库。')
    return folder, directory, target


def write_asset(folder, note_id, filename, content):
    """Publish an app-managed pasted image without replacing any existing file."""
    folder, directory, target = _asset_path(folder, note_id, filename)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.resolve().is_relative_to(folder):
            raise ValueError('图片目录已移出当前仓库。')
        with target.open('xb') as output:
            output.write(content)
        return target
    except FileExistsError as exc:
        raise ValueError('图片文件名冲突，请重新粘贴。') from exc
    except ValueError:
        raise
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise ValueError('无法把图片保存到笔记仓库，请检查文件夹权限和磁盘空间。') from exc


def read_asset(folder, note_id, filename):
    folder, _directory, target = _asset_path(folder, note_id, filename)
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(folder):
        raise ValueError('图片不存在或已移出当前仓库。')
    return target


def copy_assets(source_folder, target_folder):
    """Carry managed images along when the user changes the repository folder."""
    source = root(source_folder) / 'assets'
    target_root = root(target_folder)
    if not source.exists():
        return
    if source.is_symlink() or not source.resolve().is_relative_to(root(source_folder)):
        raise ValueError('旧仓库的图片目录无效，未切换仓库。')
    for asset in source.glob('*/*'):
        if asset.is_symlink() or not asset.is_file() or asset.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        note_id, filename = asset.parent.name, asset.name
        _folder, directory, destination = _asset_path(target_root, note_id, filename)
        directory.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.read_bytes() != asset.read_bytes():
                raise ValueError('新仓库中存在同名但内容不同的图片，未切换仓库。')
            continue
        with destination.open('xb') as output, asset.open('rb') as source_file:
            shutil.copyfileobj(source_file, output)
