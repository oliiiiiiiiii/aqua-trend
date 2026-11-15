"""Launch the research API and Next.js together from any working directory."""
import argparse
import json
from http.client import HTTPConnection
import os
from pathlib import Path
import shutil
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


def ollama_running():
    connection = HTTPConnection("127.0.0.1", 11434, timeout=1)
    try:
        connection.request("GET", "/api/version")
        response = connection.getresponse()
        if response.status == 200:
            return isinstance(json.loads(response.read(2048)).get("version"), str)
    except (OSError, ValueError, AttributeError):
        pass
    finally:
        connection.close()
    return False


def launch_local_selector(env):
    if env.get("AQUA_SELECTOR_URL") or env.get("AQUA_SELECTOR_MODEL") or env.get("AQUA_LOCAL_SELECTOR_URL"):
        return None
    if ollama_running():
        return None
    binary = shutil.which("ollama")
    if not binary:
        print("Local variable selection needs Ollama. Prepared topics are available.", flush=True)
        return None
    process = subprocess.Popen([binary, "serve"], start_new_session=True,
                               env={**env, "OLLAMA_HOST": "127.0.0.1:11434", "OLLAMA_NO_CLOUD": "1"})
    deadline = time.monotonic() + 10
    try:
        while process.poll() is None and time.monotonic() < deadline:
            if ollama_running():
                break
            time.sleep(.1)
    except KeyboardInterrupt:
        process.terminate()
        process.wait()
        raise
    return process


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
    local_selector = None
    try:
        local_selector = launch_local_selector(env)
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
        if local_selector is not None:
            children.append(local_selector)
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            child.wait()


if __name__ == "__main__":
    sys.exit(main())
