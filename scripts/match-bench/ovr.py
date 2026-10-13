# Append hand-review corrections to the bench's pair overrides.
# usage: python3 -I scripts/match-bench/ovr.py < corrections.tsv
#   each line: resumeId<TAB>postingId<TAB>key=value[,key=value]<TAB>note
#   keys: role (target|adjacent|related|old|off), seniority (ok|too_junior|too_senior),
#         location (ok|remote_ok|mismatch|unknown), auth (ok|fail), licence (ok|fail)
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "..", "src", "test", "fixtures", "match-bench", "judgments", "overrides.json")
ALLOWED = {
    "role": {"target", "adjacent", "related", "old", "off"},
    "seniority": {"ok", "too_junior", "too_senior"},
    "location": {"ok", "remote_ok", "mismatch", "unknown"},
    "auth": {"ok", "fail"},
    "licence": {"ok", "fail"},
}
d = json.load(open(PATH, encoding="utf-8")) if os.path.exists(PATH) else {}
n = 0
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line.strip() or line.startswith("#"):
        continue
    rid, pid, kv, note = line.split("\t")
    o = d.get(f"{rid}::{pid}", {})
    for pair in kv.split(","):
        k, v = (s.strip() for s in pair.split("="))
        if k not in ALLOWED or v not in ALLOWED[k]:
            sys.exit(f"refusing {k}={v} for {rid}::{pid}")
        o[k] = v
    o["note"] = note
    d[f"{rid}::{pid}"] = o
    n += 1
with open(PATH, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=1, ensure_ascii=False)
print(f"{n} corrections written; {len(d)} total")
