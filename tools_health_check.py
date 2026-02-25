#!/usr/bin/env python3
"""
Pi-Guy Tools Health Check Script

Run this script to verify all tools and endpoints are working correctly.
Should be run after any changes to tools, endpoints, or agent configuration.

Usage:
    python3 tools_health_check.py [--remote]

    --remote    Test against your production server
                Default: localhost:5000
"""

import sys
import json
import requests
from datetime import datetime

# Configuration
LOCAL_URL = "http://localhost:5000"
REMOTE_URL = os.getenv('REMOTE_URL', 'http://localhost:5001')
AGENT_ID = "agent_0801kb2240vcea2ayx0a2qxmheha"

# All tools that should exist
EXPECTED_TOOLS = {
    "tool_5601kb73sh06e6q9t8ng87bv1qsa": {
        "name": "check_server_status",
        "endpoint": "/api/server-status",
        "test_params": {},
        "expected_fields": ["cpu_percent", "memory_used_percent", "summary"]
    },
    "tool_3401kb73sh07ed5bvhtshsbxq35j": {
        "name": "look_and_see",
        "endpoint": "/api/vision",
        "test_params": {},
        "expected_fields": ["response"]  # Will say "can't see" if no camera
    },
    "tool_1901kb73sh08f27bct0d3w81qdgn": {
        "name": "identify_person",
        "endpoint": "/api/identity",
        "test_params": {},
        "expected_fields": ["name", "response"]
    },
    "tool_4801kb73sh09fxfsvjf3csmca1w5": {
        "name": "manage_todos",
        "endpoint": "/api/todos",
        "test_params": {"user_id": "health_check_test"},
        "expected_fields": ["todos", "response"]
    },
    "tool_2901kb73sh0ae2a8z7yj04v4chn1": {
        "name": "search_web",
        "endpoint": "/api/search",
        "test_params": {"query": "test"},
        "expected_fields": ["query", "response"]
    },
    "tool_3501kb73sh0be5tt4xb5162ejdxz": {
        "name": "run_command",
        "endpoint": "/api/command",
        "test_params": {"command": "date"},
        "expected_fields": ["command", "output", "response"]
    },
    "tool_8001kb754p5setqb2qedb7rfez15": {
        "name": "manage_notes",
        "endpoint": "/api/notes",
        "test_params": {"action": "list"},
        "expected_fields": ["notes", "response"]
    },
    "tool_0301kb77mf7vf0sbdyhxn3w470da": {
        "name": "manage_memory",
        "endpoint": "/api/memory",
        "test_params": {"action": "list"},
        "expected_fields": ["memories", "response"]
    },
    "tool_6801kb79mrdwfycsawytjq0gx1ck": {
        "name": "manage_jobs",
        "endpoint": "/api/jobs",
        "test_params": {"action": "list"},
        "expected_fields": ["jobs", "response"]
    },
}

# Additional endpoints not tied to ElevenLabs tools
OTHER_ENDPOINTS = {
    "/api/health": {"expected_fields": ["status"]},
    "/api/faces": {"expected_fields": []},  # Returns dict of faces
    "/api/commands": {"expected_fields": ["commands"]},
    "/api/jobs/actions": {"expected_fields": ["actions"]},
}


class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def print_header(text):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{text}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")


def print_ok(text):
    print(f"  {Colors.GREEN}✓{Colors.RESET} {text}")


def print_fail(text):
    print(f"  {Colors.RED}✗{Colors.RESET} {text}")


def print_warn(text):
    print(f"  {Colors.YELLOW}⚠{Colors.RESET} {text}")


def print_info(text):
    print(f"  {Colors.BLUE}ℹ{Colors.RESET} {text}")


def test_endpoint(base_url, endpoint, params=None, expected_fields=None):
    """Test a single endpoint"""
    url = f"{base_url}{endpoint}"
    try:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"

        data = r.json()

        if expected_fields:
            missing = [f for f in expected_fields if f not in data]
            if missing:
                return False, f"Missing fields: {missing}"

        return True, data
    except requests.exceptions.Timeout:
        return False, "Timeout"
    except requests.exceptions.ConnectionError:
        return False, "Connection refused"
    except json.JSONDecodeError:
        return False, "Invalid JSON response"
    except Exception as e:
        return False, str(e)


def check_elevenlabs_agent(api_key):
    """Verify ElevenLabs agent configuration"""
    try:
        r = requests.get(
            f"https://api.elevenlabs.io/v1/convai/agents/{AGENT_ID}",
            headers={"xi-api-key": api_key},
            timeout=30
        )
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"

        data = r.json()
        tool_ids = data.get("conversation_config", {}).get("agent", {}).get("prompt", {}).get("tool_ids", [])
        rag_enabled = data.get("conversation_config", {}).get("agent", {}).get("prompt", {}).get("rag", {}).get("enabled", False)

        return True, {"tool_ids": tool_ids, "rag_enabled": rag_enabled}
    except Exception as e:
        return False, str(e)


def main():
    # Determine target
    remote = "--remote" in sys.argv
    base_url = REMOTE_URL if remote else LOCAL_URL

    print_header(f"Pi-Guy Tools Health Check - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print_info(f"Target: {base_url}")

    results = {"passed": 0, "failed": 0, "warnings": 0}

    # 1. Basic server health
    print_header("1. Server Health")
    ok, data = test_endpoint(base_url, "/api/health", expected_fields=["status"])
    if ok:
        print_ok(f"Server is running: {data.get('status', 'ok')}")
        results["passed"] += 1
    else:
        print_fail(f"Server not responding: {data}")
        results["failed"] += 1
        print(f"\n{Colors.RED}Cannot continue without server running!{Colors.RESET}")
        return 1

    # 2. Test all tool endpoints
    print_header("2. Tool Endpoints")
    for tool_id, tool_info in EXPECTED_TOOLS.items():
        name = tool_info["name"]
        endpoint = tool_info["endpoint"]
        params = tool_info["test_params"]
        expected = tool_info["expected_fields"]

        ok, data = test_endpoint(base_url, endpoint, params, expected)
        if ok:
            # Check for error in response
            if isinstance(data, dict) and "error" in data and data["error"]:
                print_warn(f"{name} ({endpoint}): Returned error - {data.get('error', 'unknown')}")
                results["warnings"] += 1
            else:
                preview = str(data.get("response", data))[:50] if isinstance(data, dict) else str(data)[:50]
                print_ok(f"{name} ({endpoint}): OK - {preview}...")
                results["passed"] += 1
        else:
            print_fail(f"{name} ({endpoint}): {data}")
            results["failed"] += 1

    # 3. Test other endpoints
    print_header("3. Other Endpoints")
    for endpoint, config in OTHER_ENDPOINTS.items():
        ok, data = test_endpoint(base_url, endpoint, expected_fields=config["expected_fields"])
        if ok:
            print_ok(f"{endpoint}: OK")
            results["passed"] += 1
        else:
            print_fail(f"{endpoint}: {data}")
            results["failed"] += 1

    # 4. Check ElevenLabs agent configuration (if API key available)
    print_header("4. ElevenLabs Agent Configuration")
    try:
        import os
        from dotenv import load_dotenv
        load_dotenv()
        api_key = os.getenv("ELEVENLABS_API_KEY")

        if not api_key:
            print_warn("ELEVENLABS_API_KEY not found in .env - skipping agent check")
            results["warnings"] += 1
        else:
            ok, data = check_elevenlabs_agent(api_key)
            if ok:
                tool_ids = data["tool_ids"]
                rag_enabled = data["rag_enabled"]

                # Check all expected tools are attached
                missing_tools = []
                for expected_id in EXPECTED_TOOLS.keys():
                    if expected_id not in tool_ids:
                        missing_tools.append(expected_id)

                if missing_tools:
                    print_fail(f"Missing tools from agent: {missing_tools}")
                    results["failed"] += 1
                else:
                    print_ok(f"All {len(EXPECTED_TOOLS)} tools attached to agent")
                    results["passed"] += 1

                if rag_enabled:
                    print_ok("RAG is enabled")
                    results["passed"] += 1
                else:
                    print_warn("RAG is disabled")
                    results["warnings"] += 1

                # Check for extra tools
                extra_tools = [t for t in tool_ids if t not in EXPECTED_TOOLS]
                if extra_tools:
                    print_warn(f"Extra tools attached (update this script!): {extra_tools}")
                    results["warnings"] += 1
            else:
                print_fail(f"Could not check agent: {data}")
                results["failed"] += 1
    except ImportError:
        print_warn("python-dotenv not installed - skipping agent check")
        results["warnings"] += 1

    # 5. Summary
    print_header("Summary")
    total = results["passed"] + results["failed"]

    print(f"  Passed:   {Colors.GREEN}{results['passed']}{Colors.RESET}/{total}")
    print(f"  Failed:   {Colors.RED}{results['failed']}{Colors.RESET}/{total}")
    print(f"  Warnings: {Colors.YELLOW}{results['warnings']}{Colors.RESET}")

    if results["failed"] == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}All checks passed!{Colors.RESET}")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}Some checks failed. Please review above.{Colors.RESET}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
