import sys, os, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.http import safe_fetch, SsrfError


class TestSsrfGuard(unittest.TestCase):
    def test_refuses_non_http_protocol(self):
        with self.assertRaises(SsrfError):
            safe_fetch("file:///etc/passwd")

    def test_refuses_non_allowlisted_host(self):
        with self.assertRaises(SsrfError):
            safe_fetch("https://example.com/")

    def test_refuses_loopback_literal_ip(self):
        # Literal 127.0.0.1 is both non-allowlisted and a private IP.
        with self.assertRaises(SsrfError):
            safe_fetch("http://127.0.0.1:80/")

    def test_refuses_link_local_metadata(self):
        # 169.254.169.254 is the AWS instance metadata endpoint.
        with self.assertRaises(SsrfError):
            safe_fetch("http://169.254.169.254/latest/meta-data/")


if __name__ == "__main__":
    unittest.main()
