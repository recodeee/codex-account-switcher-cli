#!/usr/bin/env python3
import argparse
import os
import re
import sys

DATA_DIR = os.path.expanduser("~/.local/share/kiro-cli")
DATA_FILE = os.path.join(DATA_DIR, "data.sqlite3")
SWITCHER_DIR = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "kiro-account-switcher")
ACTIVE_FILE = os.path.join(SWITCHER_DIR, "active")


def error(msg):
    print(msg)
    sys.exit(1)


def valid_name(name):
    return bool(re.fullmatch(r'[A-Za-z0-9._-]+', name))


def convert_existing():
    name = input("What AWS account is this for? ").strip()
    if not valid_name(name):
        error("Invalid name. Use only letters, numbers, hyphens, underscores, and dots.")
    target = os.path.join(DATA_DIR, f"{name}.sqlite3")
    if os.path.exists(target):
        error(f"{target} already exists.")
    os.rename(DATA_FILE, target)
    os.symlink(target, DATA_FILE)
    os.makedirs(SWITCHER_DIR, exist_ok=True)
    with open(ACTIVE_FILE, "w") as f:
        f.write(name)
    print(f"Renamed to {name}.sqlite3 and symlinked.")


def list_and_switch():
    files = sorted(
        f for f in os.listdir(DATA_DIR)
        if f.endswith(".sqlite3") and f != "data.sqlite3"
    )
    if not files:
        error(f"No account databases found in {DATA_DIR}")
    for i, f in enumerate(files, 1):
        print(f"  {i}) {f.removesuffix('.sqlite3')}")
    while True:
        choice = input("Pick a number: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(files):
            break
        print("Invalid choice, try again.")
    target = os.path.join(DATA_DIR, files[int(choice) - 1])
    if os.path.islink(DATA_FILE):
        os.remove(DATA_FILE)
    elif os.path.exists(DATA_FILE):
        error(f"{DATA_FILE} is a regular file, not a symlink. Run without --new first to convert it.")
    chosen = files[int(choice) - 1]
    os.symlink(target, DATA_FILE)
    name = chosen.removesuffix(".sqlite3")
    os.makedirs(SWITCHER_DIR, exist_ok=True)
    with open(ACTIVE_FILE, "w") as f:
        f.write(name)
    print(f"Switched to {name}")


def new_account():
    if os.path.islink(DATA_FILE):
        os.remove(DATA_FILE)
        print(f"Removed symlink. Run 'kiro login' to set up a new account.")
    elif os.path.exists(DATA_FILE):
        error(f"{DATA_FILE} exists but is not a symlink.")
    else:
        print("No symlink to remove.")


def main():
    parser = argparse.ArgumentParser(
        description="Hot-swap between Kiro CLI accounts.\n\n"
            "With no arguments, lists available account databases and lets you\n"
            "switch between them by updating the data.sqlite3 symlink.\n\n"
            "If data.sqlite3 is a regular file (first run), you'll be prompted\n"
            "to name it so it can be converted to a symlink-based setup.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--new", action="store_true",
        help="Remove the data.sqlite3 symlink so you can run 'kiro login' for a new account.",
    )
    args = parser.parse_args()

    if args.new:
        new_account()
    elif os.path.isfile(DATA_FILE) and not os.path.islink(DATA_FILE):
        convert_existing()
    else:
        list_and_switch()


if __name__ == "__main__":
    main()
