"""Tests for route.py. Self-contained, no dependencies — `python test-route.py`.

The cases that earn their place are the ones that already went wrong once in
production: a folder dissolve that erased the only distinguishing information,
a census that counted a folder twice and split an 11-file client, a credential
regex that matched hex inside a GUID, and a life-area folder handed a
client-shaped bucket.
"""

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import route                                                        # noqa: E402

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        FAILURES.append(name)


def make_plan(src_root, dest):
    moves = []
    for f in sorted(src_root.rglob("*")):
        if f.is_file():
            st = f.stat()
            moves.append({"src": str(f), "dst": str(dest / f.name),
                          "size": st.st_size, "mtime_ns": st.st_mtime_ns,
                          "reason": "test"})
    return moves


def test_dissolve_keeps_folder_meaning():
    """Fourteen mockups named `absara-code.html` in fourteen folders must not
    become `-2 … -14`. Every member of the group carries its folder."""
    tmp = Path(tempfile.mkdtemp())
    try:
        for folder in ("login_page", "system_settings", "user_management"):
            d = tmp / "src" / folder
            d.mkdir(parents=True)
            (d / "20251030-absara-code.html").write_text(folder)
        dest = tmp / "out"
        moves = make_plan(tmp / "src", dest)
        route.disambiguate(moves)
        names = sorted(Path(m["dst"]).name for m in moves)
        check("dissolve: no blind numeric suffix",
              not any(n.rstrip(".html").endswith(("-2", "-3")) for n in names), names)
        check("dissolve: every folder name survives",
              all(any(slug in n for n in names)
                  for slug in ("login-page", "system-settings", "user-management")),
              names)
        check("dissolve: names stay unique", len(set(names)) == len(names), names)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_single_file_keeps_its_name():
    """Disambiguation must not fire when there is nothing to disambiguate."""
    tmp = Path(tempfile.mkdtemp())
    try:
        d = tmp / "src" / "somewhere"
        d.mkdir(parents=True)
        (d / "20260101-din-deck.pptx").write_text("x")
        moves = make_plan(tmp / "src", tmp / "out")
        route.disambiguate(moves)
        check("no clash: name untouched",
              Path(moves[0]["dst"]).name == "20260101-din-deck.pptx",
              moves[0]["dst"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_credentials_never_route():
    for name in ("genesis_accessKeys.csv", "client-secret-123.json",
                 "20260406-personal-github-recovery-codes.txt",
                 "server.pem", "wallet-seed-phrase.txt"):
        dest, why = route.classify(Path("/x") / name, 10)
        check(f"credential held: {name}", dest is None and "credential" in why, why)


def test_guid_is_not_a_credential():
    """`e2fa` and `442fad` are hex inside a GUID, not two-factor anything."""
    for name in ("20260605-misc-abcb8cbc-e2fa-4870-bb21-0f018ac0643e.tmp",
                 "20260520-misc-551ff972-3e3a-404d-993d-5aa9442fad0d.jpeg"):
        dest, why = route.classify(Path("/x") / name, 10)
        check(f"guid routed normally: {name[:28]}…", dest is not None, why)


def test_heavy_source_stays_local():
    big = 60 * 1024 * 1024
    dest, why = route.classify(Path("/x/20260623-palazuelos-casa-gdb001.zip"), big)
    check("heavy source stays out of the synced drive",
          dest is not None and "proyectos" in str(dest) and "OneDrive" not in str(dest), dest)
    small, _ = route.classify(Path("/x/20260623-palazuelos-notas.pdf"), 1024)
    check("light file of the same entity still routes to OneDrive",
          "OneDrive" in str(small), small)


def test_personal_never_takes_client_buckets():
    """`personal/03-entregables` describes nothing anyone owns."""
    check("personal is not subdividable", "personal" not in route.SUBDIVIDABLE)
    check("uc3m is not subdividable", "uc3m" not in route.SUBDIVIDABLE)
    check("a client is subdividable", "munet" in route.SUBDIVIDABLE)
    dest, _ = route.classify(Path("/x/20260101-personal-boardingpass.pdf"), 10,
                             big_entities={"personal", "munet"})
    check("personal ignores the bucket shape",
          "03-entregables" not in str(dest) and "04-insumos" not in str(dest), dest)


def test_census_does_not_double_count():
    """A destination home inside a scanned root must be tallied once."""
    tmp = Path(tempfile.mkdtemp())
    try:
        home = tmp / "iago" / "01-clientes" / "o11e"
        home.mkdir(parents=True)
        for i in range(11):
            (home / f"2026010{i % 10}-o11e-doc-{i}.pdf").write_text("x")
        original, route.ONEDRIVE = route.ONEDRIVE, tmp
        try:
            big = route.census([tmp / "iago" / "01-clientes"])
        finally:
            route.ONEDRIVE = original
        check("11 files counted once, stays below the threshold",
              "o11e" not in big, big)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_override_beats_the_filename_tag():
    name = ("20260518-palazuelos-unsolicited-investment-order-"
            "portfolio-8-sac-phase-1-of-3.pdf")
    dest, why = route.classify(Path("/x") / name, 1024)
    check("mis-tagged Santander order routes to personal finance",
          "banca-inversion" in str(dest) and "01-clientes" not in str(dest), dest)
    check("override says so in the reason", "override" in why, why)


def test_purpose_beats_extension():
    dest, _ = route.classify(Path("/x/20260429-misc-screenshot-133614.png"), 10)
    check("screenshot files as a capture", dest.name == "capturas", dest)
    dest, _ = route.classify(Path("/x/20260422-misc-kling-camera-5861.mp4"), 10)
    check("AI render files as media", dest.name == "media", dest)
    dest, _ = route.classify(Path("/x/20260203-misc-explicacion-synapse.pdf"), 10)
    check("loose PDF files as reference", dest.name == "referencia", dest)


def test_machine_managed_untouched():
    for name in ("desktop.ini", "Thumbs.db", "Microsoft.Services.Store.winmd"):
        dest, why = route.classify(Path("/x") / name, 10)
        check(f"machine-managed held: {name}", dest is None, why)


def main():
    for test in sorted(
        (v for k, v in globals().items() if k.startswith("test_")),
        key=lambda f: f.__code__.co_firstlineno,
    ):
        print(f"\n{test.__name__}")
        test()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} — " + ", ".join(FAILURES))
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
