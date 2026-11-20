"""Create a clean source ZIP without environment files, databases or Git history."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/downloads/dealloot-source.zip'
ROOT_FILES = {'README.md', 'package.json', 'yarn.lock', 'render.yaml', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'components.json', 'eslint.config.js', '.gitignore', '.env.example'}
DIRECTORIES = {'src', 'public', 'scripts', 'frontend', 'backend'}
EXCLUDED = {'node_modules', '__pycache__', 'tests', 'test', 'downloads', '.output', '.git', '.emergent'}
def included(path):
    rel = path.relative_to(ROOT)
    if path.is_symlink() or any(part in EXCLUDED for part in rel.parts):
        return False
    if path.name.startswith('.env'):
        return rel.as_posix() == '.env.example'
    if path.suffix in {'.pyc', '.log', '.zip'}:
        return False
    return len(rel.parts) == 1 and path.name in ROOT_FILES or len(rel.parts) > 1 and rel.parts[0] in DIRECTORIES

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(OUTPUT, 'w', ZIP_DEFLATED) as archive:
    for directory in DIRECTORIES:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() and included(path):
                archive.write(path, path.relative_to(ROOT))
    for name in ROOT_FILES:
        path = ROOT / name
        if path.is_file(): archive.write(path, name)
with ZipFile(OUTPUT) as archive:
    assert not any(Path(name).name.startswith('.env') and name != '.env.example' for name in archive.namelist())
print('Clean source archive created:', OUTPUT)