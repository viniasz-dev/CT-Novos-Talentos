"""Cifras clássicas (César e Vigenère) para a página didática /criptografia/.

ATENÇÃO: estas cifras são INSEGURAS. César tem só 25 chaves (quebra por força
bruta em milissegundos) e Vigenère cai com análise de frequência (Kasiski).
Nunca use este módulo para proteger dados reais: contato, mensagem e telefone
do sistema são cifrados com Fernet em `common/crypto.py`.

Regra das letras (vale para as duas cifras):
- Letras A-Z e a-z andam no alfabeto de 26 letras, preservando maiúscula/minúscula.
- Letras acentuadas do português (á, ã, ç, é, ô...) são decompostas em NFD:
  a letra base anda e a marca (acento, til, cedilha) é mantida. Ex.: César +3
  em "ç" vira "f" + cedilha. O resultado volta para NFC; quando não existe
  caractere pronto (como "f̧"), fica a letra seguida da marca combinante.
- Qualquer outro caractere (dígitos, espaço, pontuação, emoji, quebra de linha)
  passa sem mudança.
"""

import unicodedata

ALPHABET_SIZE = 26
MIN_SHIFT, MAX_SHIFT = 1, 25
MAX_KEY_LEN = 32

# Frequência aproximada das letras no português (%), usada só para ordenar
# os candidatos da força bruta (criptoanálise didática).
PT_FREQ = {
    "a": 14.6, "b": 1.0, "c": 3.9, "d": 5.0, "e": 12.6, "f": 1.0, "g": 1.3,
    "h": 1.3, "i": 6.2, "j": 0.4, "k": 0.02, "l": 2.8, "m": 4.7, "n": 5.0,
    "o": 10.7, "p": 2.5, "q": 1.2, "r": 6.5, "s": 7.8, "t": 4.3, "u": 4.6,
    "v": 1.7, "w": 0.04, "x": 0.2, "y": 0.01, "z": 0.5,
}


def _validate_text(text) -> str:
    if not isinstance(text, str):
        raise ValueError("O texto deve ser uma string.")
    return unicodedata.normalize("NFC", text)


def _validate_shift(shift) -> int:
    if isinstance(shift, bool) or not isinstance(shift, int) or not MIN_SHIFT <= shift <= MAX_SHIFT:
        raise ValueError(f"O deslocamento deve ser um inteiro de {MIN_SHIFT} a {MAX_SHIFT}.")
    return shift


def _validate_key(key) -> str:
    if (not isinstance(key, str) or not 1 <= len(key) <= MAX_KEY_LEN
            or not all(c.isascii() and c.isalpha() for c in key)):
        raise ValueError(f"A chave deve ter de 1 a {MAX_KEY_LEN} letras (A-Z, sem acento).")
    return key


def _split_letter(char: str):
    """(base, marcas, maiúscula) se `char` é letra A-Z (com ou sem acento); senão None."""
    decomposed = unicodedata.normalize("NFD", char)
    base, marks = decomposed[0], decomposed[1:]
    if not (base.isascii() and base.isalpha()):
        return None
    if any(not unicodedata.combining(m) for m in marks):
        return None
    return base, marks, base.isupper()


def _shift_char(char: str, delta: int):
    """Devolve (saida, indice, indice_deslocado) ou (char, None, None) se não for letra."""
    parts = _split_letter(char)
    if parts is None:
        return char, None, None
    base, marks, upper = parts
    index = ord(base.lower()) - ord("a")
    shifted = (index + delta) % ALPHABET_SIZE
    letter = chr(ord("A" if upper else "a") + shifted)
    return unicodedata.normalize("NFC", letter + marks), index, shifted


def _caesar(text: str, delta: int) -> list[dict]:
    steps = []
    for char in text:
        out, index, shifted = _shift_char(char, delta)
        steps.append({"char": char, "index": index, "shifted_index": shifted,
                      "out": out, "is_letter": index is not None})
    return steps


def _join(steps: list[dict]) -> str:
    return unicodedata.normalize("NFC", "".join(s["out"] for s in steps))


def caesar_steps(text, shift) -> list[dict]:
    """Passo a passo da cifragem: um item por caractere do texto (NFC)."""
    return _caesar(_validate_text(text), _validate_shift(shift))


def caesar_encrypt(text, shift) -> str:
    return _join(caesar_steps(text, shift))


def caesar_decrypt(text, shift) -> str:
    return _join(_caesar(_validate_text(text), -_validate_shift(shift)))


def _pt_score(text: str) -> float:
    """Quanto o texto parece português (soma das frequências das letras / letras)."""
    letters = []
    for char in text:
        parts = _split_letter(char)
        if parts:
            letters.append(parts[0].lower())
    if not letters:
        return 0.0
    return round(sum(PT_FREQ[c] for c in letters) / len(letters), 3)


def caesar_bruteforce(ciphertext) -> list[dict]:
    """Os 25 candidatos (deslocamentos 1..25), com nota de 'parece português'."""
    text = _validate_text(ciphertext)
    out = []
    for shift in range(MIN_SHIFT, MAX_SHIFT + 1):
        candidate = caesar_decrypt(text, shift)
        out.append({"shift": shift, "text": candidate, "score": _pt_score(candidate)})
    return out


def _vigenere(text: str, key: str, sign: int) -> list[dict]:
    shifts = [ord(c.lower()) - ord("a") for c in key]
    steps = []
    k = 0  # a chave só avança em letras
    for char in text:
        if _split_letter(char) is None:
            steps.append({"char": char, "index": None, "shifted_index": None, "out": char,
                          "is_letter": False, "key_char": None, "key_shift": None})
            continue
        delta = shifts[k % len(shifts)]
        out, index, shifted = _shift_char(char, sign * delta)
        steps.append({"char": char, "index": index, "shifted_index": shifted, "out": out,
                      "is_letter": True, "key_char": key[k % len(key)].upper(),
                      "key_shift": delta})
        k += 1
    return steps


def vigenere_steps(text, key, decrypt: bool = False) -> list[dict]:
    return _vigenere(_validate_text(text), _validate_key(key), -1 if decrypt else 1)


def vigenere_encrypt(text, key) -> str:
    return _join(vigenere_steps(text, key))


def vigenere_decrypt(text, key) -> str:
    return _join(vigenere_steps(text, key, decrypt=True))
