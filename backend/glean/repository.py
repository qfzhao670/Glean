"""Markdown persistence, independent of any external notes application."""
from __future__ import annotations

import os
import re
import errno
import shutil
import tempfile
from pathlib import Path


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
