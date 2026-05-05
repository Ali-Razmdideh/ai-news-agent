import sys, os, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.update(
    {
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-test",
        "TELEGRAM_BOT_TOKEN": "123:abc",
        "TELEGRAM_CHANNEL_ID": "-1001111111111",
        "TELEGRAM_DISCUSSION_GROUP_ID": "-1002222222222",
        "ADMIN_TG_USER_ID": "42",
        "AI_NEWS_DB": ":memory:",
    }
)

from core.access import is_trusted_reader, add_trusted_reader, remove_trusted_reader


class TestTrustedReaders(unittest.TestCase):
    def test_unknown_user_is_not_trusted(self):
        self.assertFalse(is_trusted_reader("9999"))

    def test_add_then_is_trusted(self):
        add_trusted_reader("1001", added_by="42")
        self.assertTrue(is_trusted_reader("1001"))

    def test_remove_then_not_trusted(self):
        add_trusted_reader("1002", added_by="42")
        remove_trusted_reader("1002")
        self.assertFalse(is_trusted_reader("1002"))

    def test_add_idempotent(self):
        add_trusted_reader("1003", added_by="42")
        add_trusted_reader("1003", added_by="42")  # INSERT OR IGNORE
        self.assertTrue(is_trusted_reader("1003"))

    def test_user_id_coerced_to_str(self):
        add_trusted_reader(1004, added_by="42")
        self.assertTrue(is_trusted_reader(1004))
        self.assertTrue(is_trusted_reader("1004"))


if __name__ == "__main__":
    unittest.main()
