#!/usr/bin/env python3
"""Build-time validation: fail if any bundled MTR bus route file has duplicate seq numbers.
Run before every deploy. Prevents the 2026-10-19 data corruption from recurring."""
import json
import sys
from collections import Counter
from pathlib import Path

routes_dir = Path(__file__).parent.parent / "public" / "mtr" / "routes"
errors = []

for f in sorted(routes_dir.glob("*.json")):
    try:
        data = json.loads(f.read_text())
    except Exception as e:
        errors.append(f"{f.name}: JSON parse error: {e}")
        continue
    stops = data.get("stops", data) if isinstance(data, dict) else data
    if not isinstance(stops, list):
        errors.append(f"{f.name}: no stops list found")
        continue
    seqs = [s.get("seq") for s in stops if isinstance(s, dict)]
    dup = [s for s, c in Counter(seqs).items() if c > 1]
    if dup:
        errors.append(f"{f.name}: duplicate seq numbers: {sorted(dup)}")
    if any(s is None for s in seqs):
        errors.append(f"{f.name}: missing seq values")
    # Note: gaps in seq (e.g. K73-I missing seq 6) are allowed — MTR may have
    # removed stops. Only duplicates are fatal.

if errors:
    print("DATA VALIDATION FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"Data validation passed: {len(list(routes_dir.glob('*.json')))} MTR route files OK")
