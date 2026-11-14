"""Launch the research API and Next.js together from any working directory."""
import argparse
from http.client import HTTPConnection
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def wait_for_api(process, port):
    deadline = time.monotonic() + 90
    while process.poll() is None and time.monotonic() < deadline:
        connection = HTTPConnection("127.0.0.1", port, timeout=.5)
        try:
            connection.request("GET", "/api/health")
            if connection.getresponse().status == 200:
                return
        except OSError:
            pass
        finally:
            connection.close()
        time.sleep(.15)
    raise RuntimeError("Research API did not start. Check its startup message above.")


def main():
    root = Path(__file__).resolve().parents[1]
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--web-port", type=int, default=3000)
    cli.add_argument("--api-port", type=int, default=8765)
    cli.add_argument("--production", action="store_true", help="Serve the previously built Next.js application")
    args = cli.parse_args()
    if not (root / "web/node_modules/next").is_dir():
        cli.exit(1, "Install the frontend once with npm ci --prefix web.\n")
    env = {**os.environ, "AQUA_RESEARCH_API_URL": f"http://127.0.0.1:{args.api_port}"}
    children = []
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        for command, directory in [
            ([sys.executable, "-m", "server.api", "--port", str(args.api_port)], root),
            (["npm", "run", "start" if args.production else "dev", "--", "--hostname", "127.0.0.1", "--port", str(args.web_port)], root / "web"),
        ]:
            children.append(subprocess.Popen(command, cwd=directory, env=env, start_new_session=True))
            if len(children) == 1:
                wait_for_api(children[0], args.api_port)
        while all(child.poll() is None for child in children):
            time.sleep(.25)
        return next((child.returncode for child in children if child.returncode is not None), 1)
    except KeyboardInterrupt:
        return 0
    finally:
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            child.wait()


if __name__ == "__main__":
    sys.exit(main())
