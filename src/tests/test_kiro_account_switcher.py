#!/usr/bin/env python3
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import kiro_account_switcher as kas


class BaseTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.switcher_dir = tempfile.mkdtemp()
        self._orig_data_dir = kas.DATA_DIR
        self._orig_data_file = kas.DATA_FILE
        self._orig_switcher_dir = kas.SWITCHER_DIR
        self._orig_active_file = kas.ACTIVE_FILE
        kas.DATA_DIR = self.tmpdir
        kas.DATA_FILE = os.path.join(self.tmpdir, "data.sqlite3")
        kas.SWITCHER_DIR = self.switcher_dir
        kas.ACTIVE_FILE = os.path.join(self.switcher_dir, "active")

    def tearDown(self):
        import shutil
        kas.DATA_DIR = self._orig_data_dir
        kas.DATA_FILE = self._orig_data_file
        kas.SWITCHER_DIR = self._orig_switcher_dir
        kas.ACTIVE_FILE = self._orig_active_file
        shutil.rmtree(self.tmpdir)
        shutil.rmtree(self.switcher_dir)


class TestValidName(unittest.TestCase):
    def test_valid(self):
        for name in ["prod", "dev-account", "my_acct.1"]:
            self.assertTrue(kas.valid_name(name))

    def test_invalid(self):
        for name in ["", "a/b", "a b", "café"]:
            self.assertFalse(kas.valid_name(name))


class TestConvertExisting(BaseTest):
    def test_converts_file_to_symlink(self):
        open(kas.DATA_FILE, "w").close()
        with patch("builtins.input", return_value="prod"):
            kas.convert_existing()
        self.assertTrue(os.path.islink(kas.DATA_FILE))
        self.assertEqual(os.readlink(kas.DATA_FILE), os.path.join(self.tmpdir, "prod.sqlite3"))
        with open(kas.ACTIVE_FILE) as f:
            self.assertEqual(f.read(), "prod")

    def test_rejects_invalid_name(self):
        open(kas.DATA_FILE, "w").close()
        with patch("builtins.input", return_value="a/b"):
            with self.assertRaises(SystemExit):
                kas.convert_existing()

    def test_rejects_duplicate_name(self):
        open(kas.DATA_FILE, "w").close()
        open(os.path.join(self.tmpdir, "prod.sqlite3"), "w").close()
        with patch("builtins.input", return_value="prod"):
            with self.assertRaises(SystemExit):
                kas.convert_existing()


class TestListAndSwitch(BaseTest):
    def test_switches_symlink(self):
        target = os.path.join(self.tmpdir, "prod.sqlite3")
        open(target, "w").close()
        os.symlink(target, kas.DATA_FILE)
        with patch("builtins.input", return_value="1"), patch("builtins.print") as mock_print:
            kas.list_and_switch()
        self.assertEqual(os.readlink(kas.DATA_FILE), target)
        mock_print.assert_any_call("  1) prod")
        mock_print.assert_any_call("Switched to prod")
        with open(kas.ACTIVE_FILE) as f:
            self.assertEqual(f.read(), "prod")

    def test_no_accounts(self):
        with self.assertRaises(SystemExit):
            kas.list_and_switch()

    def test_invalid_then_valid_choice(self):
        open(os.path.join(self.tmpdir, "prod.sqlite3"), "w").close()
        with patch("builtins.input", side_effect=["99", "abc", "1"]):
            kas.list_and_switch()
        self.assertEqual(os.readlink(kas.DATA_FILE), os.path.join(self.tmpdir, "prod.sqlite3"))

    def test_regular_file_blocks_switch(self):
        open(os.path.join(self.tmpdir, "prod.sqlite3"), "w").close()
        open(kas.DATA_FILE, "w").close()
        with patch("builtins.input", return_value="1"):
            with self.assertRaises(SystemExit):
                kas.list_and_switch()


class TestNewAccount(BaseTest):
    def test_removes_symlink(self):
        target = os.path.join(self.tmpdir, "prod.sqlite3")
        open(target, "w").close()
        os.symlink(target, kas.DATA_FILE)
        kas.new_account()
        self.assertFalse(os.path.exists(kas.DATA_FILE))

    def test_regular_file_exits(self):
        open(kas.DATA_FILE, "w").close()
        with self.assertRaises(SystemExit):
            kas.new_account()

    def test_no_symlink_is_fine(self):
        kas.new_account()  # should not raise


if __name__ == "__main__":
    unittest.main()
