import sys, os, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.update({
    "LLM_PROVIDER": "anthropic",
    "ANTHROPIC_API_KEY": "sk-ant-test",
    "TELEGRAM_BOT_TOKEN": "123:abc",
    "TELEGRAM_CHANNEL_ID": "-1001111111111",
    "TELEGRAM_DISCUSSION_GROUP_ID": "-1002222222222",
    "ADMIN_TG_USER_ID": "42",
    "AI_NEWS_DB": ":memory:",
})

from core.access import check_inbound


class TestCheckInbound(unittest.TestCase):
    def test_allows_admin_dm(self):
        r = check_inbound(kind="dm", chat_id="42", user_id="42")
        self.assertTrue(r["allow"])

    def test_denies_non_admin_dm(self):
        r = check_inbound(kind="dm", chat_id="999", user_id="999")
        self.assertFalse(r["allow"])

    def test_denies_broadcast_channel(self):
        r = check_inbound(kind="channel", chat_id="-1001111111111", user_id="42")
        self.assertFalse(r["allow"])

    def test_denies_group_without_mention(self):
        r = check_inbound(kind="group", chat_id="-1002222222222", user_id="42", is_mention=False)
        self.assertFalse(r["allow"])
        self.assertEqual(r["reason"], "group_no_mention")

    def test_denies_non_allowlisted_group_with_mention(self):
        r = check_inbound(kind="group", chat_id="-1009", user_id="42", is_mention=True)
        self.assertFalse(r["allow"])

    def test_allows_admin_in_group_with_mention(self):
        r = check_inbound(kind="group", chat_id="-1002222222222", user_id="42", is_mention=True)
        self.assertTrue(r["allow"])


if __name__ == "__main__":
    unittest.main()
