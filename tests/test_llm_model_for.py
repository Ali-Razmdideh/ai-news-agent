import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _set_env(**kwargs):
    base = {
        "TELEGRAM_BOT_TOKEN": "123:abc",
        "TELEGRAM_CHANNEL_ID": "-100",
        "TELEGRAM_DISCUSSION_GROUP_ID": "-200",
        "ADMIN_TG_USER_ID": "1",
        "AI_NEWS_DB": ":memory:",
        "MODEL_LOW": "",
        "MODEL_MID": "",
        "MODEL_HIGH": "",
    }
    base.update(kwargs)
    os.environ.update(base)


def _reload():
    """Clear lru_cache on load_env so env changes take effect."""
    import core.env as env_mod

    env_mod.load_env.cache_clear()


class TestModelFor(unittest.TestCase):
    def setUp(self):
        _reload()

    def test_anthropic_defaults(self):
        _set_env(
            LLM_PROVIDER="anthropic", ANTHROPIC_API_KEY="sk-ant-x", OPENAI_API_KEY=""
        )
        _reload()
        from core.llm import model_for

        self.assertEqual(model_for("low"), "claude-haiku-4-5")
        self.assertEqual(model_for("mid"), "claude-sonnet-4-6")
        self.assertEqual(model_for("high"), "claude-opus-4-7")

    def test_openai_defaults(self):
        _set_env(LLM_PROVIDER="openai", OPENAI_API_KEY="sk-oai-x", ANTHROPIC_API_KEY="")
        _reload()
        from core.llm import model_for

        self.assertEqual(model_for("low"), "gpt-5-mini")
        self.assertEqual(model_for("mid"), "gpt-5-mini")
        self.assertEqual(model_for("high"), "gpt-5")

    def test_per_tier_env_overrides(self):
        _set_env(
            LLM_PROVIDER="openai",
            OPENAI_API_KEY="sk-oai-x",
            ANTHROPIC_API_KEY="",
            MODEL_LOW="gpt-4o-mini",
            MODEL_HIGH="o3",
            MODEL_MID="",
        )
        _reload()
        from core.llm import model_for

        self.assertEqual(model_for("low"), "gpt-4o-mini")
        self.assertEqual(model_for("mid"), "gpt-5-mini")
        self.assertEqual(model_for("high"), "o3")

    def test_rejects_openai_without_key(self):
        _set_env(LLM_PROVIDER="openai", OPENAI_API_KEY="", ANTHROPIC_API_KEY="")
        _reload()
        from core.env import load_env

        with self.assertRaises(ValueError):
            load_env()


if __name__ == "__main__":
    unittest.main()
