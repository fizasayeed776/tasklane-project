import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings import validate_secret_key


@pytest.mark.parametrize("placeholder", ["replace-me", "change-me", "django-insecure"])
def test_production_secret_key_rejects_placeholder_text(placeholder):
    secret_key = f"{placeholder}-{ 'x' * 60}"

    with pytest.raises(ImproperlyConfigured, match="placeholder"):
        validate_secret_key(secret_key, debug=False)


def test_production_secret_key_requires_50_characters():
    with pytest.raises(ImproperlyConfigured, match="50 characters"):
        validate_secret_key("x" * 49, debug=False)


def test_debug_secret_key_keeps_development_compatibility():
    secret_key = "pytest-only-secret-key-never-use-outside-tests"

    assert validate_secret_key(secret_key, debug=True) == secret_key


def test_production_secret_key_accepts_generated_length_without_placeholder():
    secret_key = "a" * 64

    assert validate_secret_key(secret_key, debug=False) == secret_key
