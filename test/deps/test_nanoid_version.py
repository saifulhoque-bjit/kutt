"""Regression check: the lock file must not resolve a nanoid release affected by
CVE-2026-67213, CVE-2026-67214 or CVE-2026-73086 (fixed in 3.3.18)."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIN_SAFE = (3, 3, 18)


def parse(version):
    return tuple(int(p) for p in version.split("-")[0].split("."))


class NanoidVersionTest(unittest.TestCase):
    def test_lockfile_nanoid_is_patched(self):
        lock = json.loads((ROOT / "package-lock.json").read_text())
        found = {
            path: meta["version"]
            for path, meta in lock["packages"].items()
            if path == "node_modules/nanoid" or path.endswith("/node_modules/nanoid")
        }
        self.assertTrue(found, "nanoid not found in package-lock.json")
        for path, version in found.items():
            self.assertGreaterEqual(
                parse(version), MIN_SAFE, f"{path} resolves vulnerable nanoid {version}"
            )


if __name__ == "__main__":
    unittest.main()
