"""Download pinned model weights only. Never uploads audio or runs remote code."""
import argparse
import json
from pathlib import Path
from huggingface_hub import snapshot_download
parser=argparse.ArgumentParser()
parser.add_argument('--cache-dir',type=Path,required=True)
args=parser.parse_args()
manifest=json.loads((Path(__file__).resolve().parents[1]/'shared/microphone-model.json').read_text(encoding='utf8'))
path=snapshot_download(repo_id=manifest['repo'],revision=manifest['revision'],cache_dir=str(args.cache_dir),allow_patterns=[f['name'] for f in manifest['files']],token=False)
print(path)
