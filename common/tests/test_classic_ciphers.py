from django.test import SimpleTestCase

from common.classic_ciphers import (
    caesar_bruteforce,
    caesar_decrypt,
    caesar_encrypt,
    caesar_steps,
    vigenere_decrypt,
    vigenere_encrypt,
    vigenere_steps,
)

MIXED = "Ação às 19h: João & Zé 😀\nLinha 2 — çÇ ñ ü!"


class CaesarTests(SimpleTestCase):
    def test_known_vector_shift_3(self):
        self.assertEqual(caesar_encrypt("ATAQUE", 3), "DWDTXH")
        self.assertEqual(caesar_decrypt("DWDTXH", 3), "ATAQUE")

    def test_rot13(self):
        self.assertEqual(caesar_encrypt("Hello", 13), "Uryyb")
        self.assertEqual(caesar_encrypt("Uryyb", 13), "Hello")

    def test_wraps_and_keeps_case(self):
        self.assertEqual(caesar_encrypt("xyz XYZ", 3), "abc ABC")

    def test_accents_keep_mark_and_round_trip(self):
        # ç -> ḑ (d com cedilha, U+1E11); ã -> b + til combinante (não existe "b̃" pronto)
        self.assertEqual(caesar_encrypt("ção", 1), "ḑb̃p")
        self.assertEqual(caesar_encrypt("É", 1), "F́")
        self.assertEqual(caesar_encrypt("e", 1), "f")
        self.assertEqual(caesar_encrypt("á", 4), "é")  # a+acento -> e+acento = é (NFC)
        for shift in (1, 3, 13, 25):
            with self.subTest(shift=shift):
                self.assertEqual(caesar_decrypt(caesar_encrypt(MIXED, shift), shift), MIXED)

    def test_non_letters_unchanged(self):
        out = caesar_encrypt("19h 😀\n!", 5)
        self.assertEqual(out, "19m 😀\n!")

    def test_steps(self):
        steps = caesar_steps("Ab!", 3)
        self.assertEqual(steps[0], {"char": "A", "index": 0, "shifted_index": 3, "out": "D",
                                    "is_letter": True})
        self.assertEqual(steps[1]["out"], "e")
        self.assertEqual(steps[2], {"char": "!", "index": None, "shifted_index": None,
                                    "out": "!", "is_letter": False})

    def test_bruteforce_has_25_and_original(self):
        cipher = caesar_encrypt("ATAQUE AO AMANHECER", 7)
        candidates = caesar_bruteforce(cipher)
        self.assertEqual([c["shift"] for c in candidates], list(range(1, 26)))
        self.assertIn("ATAQUE AO AMANHECER", [c["text"] for c in candidates])
        best = max(candidates, key=lambda c: c["score"])
        self.assertEqual(best["shift"], 7)

    def test_invalid_shift(self):
        for bad in (0, 26, -1, True, 3.0, "3", None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                caesar_encrypt("abc", bad)

    def test_invalid_text(self):
        with self.assertRaises(ValueError):
            caesar_encrypt(None, 3)


class VigenereTests(SimpleTestCase):
    def test_known_vector(self):
        self.assertEqual(vigenere_encrypt("ATTACKATDAWN", "LEMON"), "LXFOPVEFRNHR")
        self.assertEqual(vigenere_decrypt("LXFOPVEFRNHR", "LEMON"), "ATTACKATDAWN")

    def test_key_case_insensitive_and_skips_non_letters(self):
        self.assertEqual(vigenere_encrypt("Attack at dawn", "lemon"), "Lxfopv ef rnhr")

    def test_round_trip_mixed(self):
        self.assertEqual(vigenere_decrypt(vigenere_encrypt(MIXED, "Chave"), "Chave"), MIXED)

    def test_steps(self):
        steps = vigenere_steps("A b", "LE")
        self.assertEqual(steps[0]["key_char"], "L")
        self.assertEqual(steps[0]["key_shift"], 11)
        self.assertEqual(steps[0]["out"], "L")
        self.assertFalse(steps[1]["is_letter"])
        self.assertEqual(steps[2]["key_char"], "E")
        self.assertEqual(steps[2]["out"], "f")

    def test_invalid_key(self):
        for bad in ("", "a1", "chave secreta", "ção", "x" * 33, None, 5):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                vigenere_encrypt("abc", bad)
