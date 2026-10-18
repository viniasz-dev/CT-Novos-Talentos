from django.core.cache import cache
from django.test import SimpleTestCase

from accounts import throttle


class ThrottleTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_blocks_at_limit(self):
        self.assertFalse(throttle.check("k", 3, 60))
        for _ in range(3):
            throttle.hit("k", 60)
        self.assertTrue(throttle.check("k", 3, 60))

    def test_below_limit_not_blocked(self):
        for _ in range(2):
            throttle.hit("k", 60)
        self.assertFalse(throttle.check("k", 3, 60))

    def test_reset(self):
        for _ in range(3):
            throttle.hit("k", 60)
        throttle.reset("k")
        self.assertFalse(throttle.check("k", 3, 60))

    def test_keys_independent(self):
        for _ in range(3):
            throttle.hit("a", 60)
        self.assertFalse(throttle.check("b", 3, 60))
