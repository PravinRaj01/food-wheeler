"""Shared pytest fixtures across the whole test suite."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limit_buckets():
    # The rate limiter's bucket dict is module-global. Every test's client
    # shares the same source IP (127.0.0.1), so without a reset here, a test
    # earlier in the run could exhaust the bucket and cause an unrelated
    # test elsewhere in the suite to get a 429 instead of the response it
    # expects. See tests/test_rate_limit.py for the feature's own tests.
    app_module._rate_limit_buckets.clear()
    yield
    app_module._rate_limit_buckets.clear()
