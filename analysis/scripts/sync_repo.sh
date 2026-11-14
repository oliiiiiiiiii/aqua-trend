#!/usr/bin/env bash
# Commit and push the current analysis results to the team repo branch.
# Usage: analysis/scripts/sync_repo.sh "commit message"
# Tracks scripts, results (figures/json/csv/README), findings, IDEAS, RUNLOG. Data, *.nc, *.npy, venv, logs stay local (.gitignore).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="analysis/water-trends"
MSG="${1:-Update analysis results}"
cd "$REPO"
find analysis/scripts -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
git add -A .gitignore README.md analysis
# refuse to commit anything over 50 MB (GitHub warns at 50, rejects at 100)
big=$(git diff --cached --name-only -z | xargs -0 -r stat -c '%s %n' 2>/dev/null | awk '$1 > 50000000 {print $2}')
if [ -n "$big" ]; then echo "refusing: large files staged:"; echo "$big"; git reset -q; exit 1; fi
if git diff --cached --quiet; then echo "nothing to commit"; else
  git commit -q -m "$MSG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
fi
git push -q -u origin "$BRANCH"
git log --oneline -1
chmod 777 "$REPO"/.gitignore "$REPO"/README.md "$REPO"/LICENSE 2>/dev/null || true
