"""Markdown persistence, independent of any external notes application."""
from __future__ import annotations

import os
import re
import errno
import shutil
import tempfile
import uuid
from pathlib import Path

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


def _folder_name(name):
    value = name.strip()
    if (not value or value in ('.', '..') or Path(value).name != value or
            re.search(r'[<>:"/\\|?*\x00-\x1f]', value) or value.endswith(('.', ' '))):
        raise ValueError('文件夹名称包含无效字符。')
    if len(value) > 60:
        raise ValueError('文件夹名称不能超过 60 个字符。')
    return value


def root(path):
    target = Path(path).expanduser()
    if not target.is_absolute():
        raise ValueError('笔记仓库需要使用绝对路径。')
    if not target.is_dir():
        raise ValueError('笔记仓库目录不存在，请重新选择。')
    return target.resolve()


def _directory(folder, relative='', must_exist=True):
    """Resolve a managed directory without allowing escapes or symlinks."""
    folder = root(folder)
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('文件夹位置无效。')
    target = folder.joinpath(*relative.parts)
    if target.is_symlink():
        raise ValueError('文件夹位置无效。')
    if must_exist:
        if not target.is_dir() or not target.resolve().is_relative_to(folder):
            raise ValueError('文件夹不存在或位置无效。')
    elif not target.parent.resolve().is_relative_to(folder):
        raise ValueError('文件夹位置无效。')
    return folder, target


def ensure_folder(folder, name, exclusive=False, parent=''):
    """Return a safe managed folder below ``parent``, optionally requiring it to be new."""
    folder, parent_path = _directory(folder, parent)
    target = parent_path / _folder_name(name)
    try:
        if target.exists() or target.is_symlink():
            if exclusive:
                raise ValueError('已有同名文件夹，请换一个名称。')
            if target.is_symlink() or not target.is_dir() or not target.resolve().is_relative_to(folder):
                raise ValueError('文件夹位置无效，请换一个名称。')
            return target
        target.mkdir()
        return target
    except ValueError:
        raise
    except OSError as exc:
        raise ValueError('无法新建文件夹，请检查仓库权限和磁盘空间。') from exc


def rename_folder(folder, current, name):
    """Rename a managed folder without merging or replacing data."""
    folder, source = _directory(folder, current)
    name = _folder_name(name)
    target = source.parent / name
    if source.name == name:
        return source, target
    try:
        if source.is_symlink() or not source.is_dir() or not source.resolve().is_relative_to(folder):
            raise ValueError('原文件夹不存在或位置无效，本次未重命名。')
        # Case-only renames point at the same directory on case-insensitive file
        # systems. Move through a private temporary name so Windows and macOS
        # both preserve the requested spelling.
        same_directory = target.exists() and target.samefile(source)
        if (target.exists() or target.is_symlink()) and not same_directory:
            raise ValueError('已有同名文件夹，请换一个名称。')
        if same_directory:
            temporary = folder / ('.glean-folder-' + uuid.uuid4().hex)
            source.rename(temporary)
            try:
                temporary.rename(target)
            except OSError:
                temporary.rename(source)
                raise
        else:
            source.rename(target)
        return source, target
    except ValueError:
        raise
    except OSError as exc:
        raise ValueError('无法重命名文件夹，请检查仓库权限和磁盘空间。') from exc


def move_folder(folder, current, destination=''):
    """Move a managed folder below another managed folder without merging."""
    folder, source = _directory(folder, current)
    _folder, target_parent = _directory(folder, destination)
    target = target_parent / source.name
    try:
        if target == source:
            return source, target
        if target.exists() or target.is_symlink():
            raise ValueError('目标位置已有同名文件夹。')
        source.rename(target)
        return source, target
    except ValueError:
        raise
    except OSError as exc:
        raise ValueError('无法移动文件夹，请检查仓库权限和磁盘空间。') from exc


def move(folder, current, expected, destination=''):
    """Move a managed Markdown file without overwriting user files."""
    folder = root(folder)
    source = Path(current)
    try:
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(folder):
            raise ValueError('笔记文件已移出当前仓库，请检查保存位置。')
        if source.read_text(encoding='utf-8') != expected:
            raise ValueError('仓库文件已被其他程序修改，本次未移动。请先导入外部版本。')
        _folder, target_folder = _directory(folder, destination)
        if source.parent.resolve() == target_folder.resolve():
            return str(source)
        stem, suffix = source.stem, source.suffix
        for index in range(10000):
            target = target_folder / (stem + (f' ({index})' if index else '') + suffix)
            try:
                try:
                    os.link(source, target)
                except OSError as exc:
                    if exc.errno not in (errno.EPERM, errno.ENOTSUP, errno.EXDEV, errno.ENOSYS):
                        raise
                    with target.open('xb') as output, source.open('rb') as input_file:
                        shutil.copyfileobj(input_file, output)
                try:
                    source.unlink()
                except OSError:
                    target.unlink(missing_ok=True)
                    raise
                return str(target)
            except FileExistsError:
                continue
        raise ValueError('目标文件夹中的同名笔记过多，请调整文件名。')
    except ValueError:
        raise
    except (OSError, UnicodeError) as exc:
        raise ValueError('无法移动笔记，请检查文件夹权限和磁盘空间。') from exc


def delete_folder_tree(folder, current, expected_files, managed_directories):
    """Delete an explicitly selected managed folder and everything below it."""
    folder, source = _directory(folder, current)
    try:
        # Database paths must still belong to the selected tree. Unknown files
        # are intentionally allowed: the user chose “delete all contents”.
        for path in expected_files:
            if not Path(path).resolve().is_relative_to(source.resolve()):
                raise ValueError('文件夹中的笔记路径异常，本次未删除。')
        for path in managed_directories:
            if not Path(path).resolve().is_relative_to(source.resolve()):
                raise ValueError('文件夹层级异常，本次未删除。')
        shutil.rmtree(source)
    except ValueError:
        raise
    except (OSError, UnicodeError) as exc:
        raise ValueError(f'无法从笔记仓库 {folder} 删除文件夹，请检查文件夹权限。') from exc


def promote_folder(folder, current, destination, expected_files, child_names):
    """Remove a folder while moving every immediate item to its parent.

    Managed child folders retain their names. Other files and directories are
    preserved too, with a numeric suffix when an item at the destination exists.
    Returns a mapping from each old immediate path to its new path.
    """
    folder, source = _directory(folder, current)
    _folder, target_parent = _directory(folder, destination)
    expected = {Path(path).resolve(): content for path, content in expected_files.items()}
    children = set(child_names)
    moved = []
    reserved = {path.name for path in target_parent.iterdir() if path != source}

    def available_name(path):
        if path.name not in reserved:
            reserved.add(path.name)
            return path.name
        if path.name in children:
            raise ValueError(f'同级目录已有名为「{path.name}」的文件夹，本次未删除。')
        stem, suffix = path.stem, path.suffix
        for index in range(1, 10000):
            candidate = f'{stem} ({index}){suffix}'
            if candidate not in reserved:
                reserved.add(candidate)
                return candidate
        raise ValueError('同级目录中的同名内容过多，请先整理后再删除。')

    try:
        entries = list(source.iterdir())
        for entry in entries:
            if entry.is_symlink():
                raise ValueError('文件夹中存在符号链接，请先移出后再删除。')
        for path, content in expected.items():
            if path.parent != source.resolve() or not path.is_file():
                raise ValueError('文件夹中的笔记路径异常，本次未删除。')
            if path.read_text(encoding='utf-8') != content:
                raise ValueError('仓库文件已被外部程序修改，本次未移动。请先导入外部版本。')
        plans = [(entry, target_parent / available_name(entry)) for entry in entries]
        for old_path, new_path in plans:
            old_path.rename(new_path)
            moved.append((old_path, new_path))
        source.rmdir()
        return {str(old): str(new) for old, new in moved}
    except ValueError:
        raise
    except OSError as exc:
        raise ValueError('无法释放文件夹内容，请检查文件夹权限和磁盘空间。') from exc
    finally:
        # Best-effort rollback if an operation failed before the source was removed.
        if source.exists() and moved:
            for old_path, new_path in reversed(moved):
                try:
                    if new_path.exists() and not old_path.exists():
                        new_path.rename(old_path)
                except OSError:
                    pass


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
