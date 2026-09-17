"""
Combined Repair Kit for savDat project.
Provides three commands:
  repair   - runs repair_obsidian_links functionality
  backfill - runs backfill_obsidian functionality
  clean    - runs remove_genre_wikilinks functionality
Usage:
  python combined_repair_kit.py <command>
"""
import sys
from pathlib import Path
import subprocess

# Resolve project root assuming this script lives in the project root
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

def run_repair():
    from scripts.repair_obsidian_links import main as repair_main
    repair_main()

def run_backfill():
    subprocess.run([sys.executable, str(PROJECT_ROOT / 'scripts' / 'backfill_obsidian.py')], check=True)

def run_clean():
    from scripts.remove_genre_wikilinks import main as clean_main
    clean_main()

def main():
    if len(sys.argv) < 2:
        print('Usage: python combined_repair_kit.py <repair|backfill|clean>')
        sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd == 'repair':
        run_repair()
    elif cmd == 'backfill':
        run_backfill()
    elif cmd == 'clean':
        run_clean()
    else:
        print(f'Unknown command: {cmd}')
        sys.exit(1)

if __name__ == '__main__':
    main()
