#!/usr/bin/env bash
# saveDat Archives — Start server
cd "$(dirname "$0")"
python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
