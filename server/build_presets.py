"""Publish versioned case searches through a running research service."""
import argparse
import json
import time
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phenomena", nargs="*", help="Defaults to the prepared phenomenon plans.")
    parser.add_argument("--api-url", default="http://127.0.0.1:8765")
    args = parser.parse_args()
    base = args.api_url.rstrip("/")

    def read(path, data=None):
        req = Request(base + path, data=json.dumps(data).encode() if data is not None else None,
                      headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=30) as res:
            return json.load(res)

    queries = args.phenomena or read("/api/catalogue")["curated_phenomena"]
    failed = False
    for query in queries:
        job = read("/api/research", {"phenomenon_query": query})
        while job["status"] == "running":
            time.sleep(.25)
            job = read("/api/research/" + job["id"])
        if job["result"]:
            preset = job["result"]["resolved"]["preset"]
            print(query, preset["region_name"], preset["period"], preset["id"], preset["version"], flush=True)
        else:
            failed = True
            print(query, job["status"], job.get("error"), flush=True)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
