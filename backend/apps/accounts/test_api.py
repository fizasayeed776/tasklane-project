from datetime import timedelta
from importlib import import_module
from urllib.parse import parse_qs, urlparse

import pytest
from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Organization, OrganizationMember


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolate_throttle_cache():
    from rest_framework.throttling import SimpleRateThrottle

    # Save the current THROTTLE_RATES so each test starts with the real defaults
    # and cannot inherit a patched value from a previous test.
    original_rates = SimpleRateThrottle.THROTTLE_RATES
    cache.clear()
    yield
    cache.clear()
    # Restore in case the test patched the class attribute directly.
    SimpleRateThrottle.THROTTLE_RATES = original_rates


def register(client, email="user@example.com", password="StrongPass!234", **extra):
    return client.post(
        "/api/auth/register/",
        {"email": email, "password": password, **extra},
        format="json",
    )


def login(client, email="user@example.com", password="StrongPass!234"):
    return client.post(
        "/api/auth/login/",
        {"email": email, "password": password},
        format="json",
    )


def test_register_login_and_ignore_mass_assignment():
    client = APIClient()
    response = register(
        client,
        is_staff=True,
        is_superuser=True,
        role="OWNER",
        organization_id=999,
        created_by=999,
    )
    assert response.status_code == 201
    user = User.objects.get(email="user@example.com")
    assert user.check_password("StrongPass!234")
    assert not user.is_staff
    assert not user.is_superuser

    tokens = login(client, "USER@EXAMPLE.COM")
    assert tokens.status_code == 200
    assert set(tokens.json()) == {"access", "refresh"}
    assert login(client, password="wrong").status_code == 401


def test_register_normalizes_email_and_rejects_case_insensitive_duplicate():
    client = APIClient()

    first = register(client, email="Ali@x.com")
    duplicate = register(client, email="ali@x.com")

    assert first.status_code == 201
    assert first.json()["email"] == "ali@x.com"
    assert duplicate.status_code == 400
    assert duplicate.json()["success"] is False
    assert duplicate.json()["error"]["message"] == (
        "An account with this email already exists. Log in instead."
    )
    assert duplicate.json()["error"]["fields"] == {
        "email": ["An account with this email already exists. Log in instead."]
    }
    assert duplicate.json()["error"]["details"] == {
        "email": ["An account with this email already exists. Log in instead."]
    }
    assert "password" not in duplicate.json()["error"]["fields"]

    same_case_duplicate = register(client, email="Ali@x.com")
    assert same_case_duplicate.status_code == 400
    assert same_case_duplicate.json()["error"]["fields"] == {
        "email": ["An account with this email already exists. Log in instead."]
    }
    assert User.objects.filter(email__iexact="ali@x.com").count() == 1


def test_email_migration_reports_accounts_that_would_collide():
    migration = import_module("apps.accounts.migrations.0002_case_insensitive_email")

    with pytest.raises(RuntimeError, match="Ali@x.com.*ali@x.com"):
        migration.ensure_no_email_collisions(["Ali@x.com", "ali@x.com"])


def test_refresh_rotates_and_blacklists_previous_refresh_token():
    client = APIClient()
    assert register(client).status_code == 201
    tokens = login(client).json()

    rotated = client.post(
        "/api/auth/refresh/",
        {"refresh": tokens["refresh"]},
        format="json",
    )
    assert rotated.status_code == 200
    assert rotated.json()["refresh"] != tokens["refresh"]
    assert rotated.json()["access"]
    assert (
        client.post(
            "/api/auth/refresh/",
            {"refresh": tokens["refresh"]},
            format="json",
        ).status_code
        == 401
    )


def test_logout_blacklists_refresh_token():
    client = APIClient()
    assert register(client).status_code == 201
    tokens = login(client).json()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = client.post(
        "/api/auth/logout/",
        {"refresh": tokens["refresh"]},
        format="json",
    )
    assert response.status_code == 204
    assert (
        client.post(
            "/api/auth/refresh/",
            {"refresh": tokens["refresh"]},
            format="json",
        ).status_code
        == 401
    )
    invalid_logout = client.post(
        "/api/auth/logout/",
        {"refresh": "invalid"},
        format="json",
    )
    assert invalid_logout.status_code == 400
    assert invalid_logout.json()["success"] is False


def test_me_and_password_change_only_update_allowed_fields():
    client = APIClient()
    assert register(client).status_code == 201
    tokens = login(client).json()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = client.patch(
        "/api/auth/me/",
        {"first_name": "Tasklane", "email": "changed@example.com"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["email"] == "user@example.com"
    assert response.json()["first_name"] == "Tasklane"

    assert (
        client.post(
            "/api/auth/password/change/",
            {"old_password": "incorrect", "new_password": "AnotherStrong!567"},
            format="json",
        ).status_code
        == 400
    )
    response = client.post(
        "/api/auth/password/change/",
        {"old_password": "StrongPass!234", "new_password": "AnotherStrong!567"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["access"]
    assert response.json()["refresh"]
    assert User.objects.get(email="user@example.com").check_password(
        "AnotherStrong!567"
    )
    assert (
        client.post(
            "/api/auth/refresh/",
            {"refresh": tokens["refresh"]},
            format="json",
        ).status_code
        == 401
    )


@pytest.mark.parametrize("role", ["OWNER", "ADMIN", "MEMBER", "VIEWER"])
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_every_organization_role_can_change_own_password_and_email(role):
    mail.outbox = []
    user = User.objects.create_user("member@example.com", "StrongPass!234")
    organization = Organization.objects.create(
        name="Account settings",
        slug=f"account-settings-{role.lower()}",
        owner=user,
    )
    OrganizationMember.objects.create(organization=organization, user=user, role=role)
    client = APIClient()
    tokens = login(client, user.email, "StrongPass!234").json()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    password_response = client.post(
        "/api/auth/password/change/",
        {"old_password": "StrongPass!234", "new_password": "NewStrong!567"},
        format="json",
    )
    assert password_response.status_code == 200
    assert set(password_response.json()) == {"success", "access", "refresh"}
    assert password_response.json()["success"] is True
    assert User.objects.get(pk=user.pk).check_password("NewStrong!567")

    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {password_response.json()['access']}"
    )
    email_response = client.post(
        "/api/auth/email/change/",
        {
            "new_email": "  New.Address@Example.COM ",
            "current_password": "NewStrong!567",
        },
        format="json",
    )
    assert email_response.status_code == 200
    assert User.objects.get(pk=user.pk).email == "new.address@example.com"
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["member@example.com"]
    assert "new.address@example.com" in mail.outbox[0].body


def test_password_change_rejects_reusing_current_password():
    user = User.objects.create_user("same@example.com", "StrongPass!234")
    client = APIClient()
    client.force_authenticate(user)

    response = client.post(
        "/api/auth/password/change/",
        {"old_password": "StrongPass!234", "new_password": "StrongPass!234"},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
    assert "different" in response.json()["error"]["message"]


def test_change_password_and_email_reject_incorrect_current_password():
    user = User.objects.create_user("wrong-password@example.com", "StrongPass!234")
    client = APIClient()
    client.force_authenticate(user)

    password_response = client.post(
        "/api/auth/password/change/",
        {"old_password": "incorrect", "new_password": "NewStrong!567"},
        format="json",
    )
    email_response = client.post(
        "/api/auth/email/change/",
        {"new_email": "new@example.com", "current_password": "incorrect"},
        format="json",
    )
    assert password_response.status_code == email_response.status_code == 400
    assert password_response.json()["success"] is False
    assert email_response.json()["success"] is False
    user.refresh_from_db()
    assert user.email == "wrong-password@example.com"
    assert user.check_password("StrongPass!234")


def test_email_change_rejects_case_insensitive_duplicate():
    user = User.objects.create_user("first@example.com", "StrongPass!234")
    User.objects.create_user("second@example.com", "StrongPass!234")
    client = APIClient()
    client.force_authenticate(user)

    response = client.post(
        "/api/auth/email/change/",
        {
            "new_email": "SECOND@EXAMPLE.COM",
            "current_password": "StrongPass!234",
        },
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
    assert "already exists" in response.json()["error"]["message"]
    user.refresh_from_db()
    assert user.email == "first@example.com"


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_email_change_only_updates_authenticated_user_and_rejects_current_email():
    mail.outbox = []
    user = User.objects.create_user("own@example.com", "StrongPass!234")
    other_user = User.objects.create_user("other@example.com", "StrongPass!234")
    client = APIClient()
    client.force_authenticate(user)

    same_email = client.post(
        "/api/auth/email/change/",
        {
            "new_email": "OWN@example.com",
            "current_password": "StrongPass!234",
        },
        format="json",
    )
    assert same_email.status_code == 400

    response = client.post(
        "/api/auth/email/change/",
        {
            "new_email": "updated@example.com",
            "current_password": "StrongPass!234",
            "user_id": other_user.pk,
        },
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    other_user.refresh_from_db()
    assert user.email == "updated@example.com"
    assert other_user.email == "other@example.com"
    assert mail.outbox[-1].to == ["own@example.com"]


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/auth/password/change/",
            {"old_password": "StrongPass!234", "new_password": "NewStrong!567"},
        ),
        (
            "/api/auth/email/change/",
            {
                "new_email": "new@example.com",
                "current_password": "StrongPass!234",
            },
        ),
    ],
)
def test_account_settings_endpoints_require_authentication(path, payload):
    response = APIClient().post(path, payload, format="json")
    assert response.status_code == 401
    assert response.json()["success"] is False


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": [
            "rest_framework_simplejwt.authentication.JWTAuthentication"
        ],
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_FILTER_BACKENDS": [
            "django_filters.rest_framework.DjangoFilterBackend",
            "rest_framework.filters.SearchFilter",
            "rest_framework.filters.OrderingFilter",
        ],
        "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
        "PAGE_SIZE": 50,
        "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
        "EXCEPTION_HANDLER": "config.exceptions.handler",
        "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
        "DEFAULT_THROTTLE_RATES": {
            "auth_login": "100/min",
            "auth_register": "100/min",
            "auth_refresh": "100/min",
            "auth_password": "100/min",
            "auth_account": "100/min",
        },
    }
)
def test_forgot_password_is_non_enumerating_and_reset_token_is_single_use():
    from rest_framework.throttling import SimpleRateThrottle

    old_rates = SimpleRateThrottle.THROTTLE_RATES
    SimpleRateThrottle.THROTTLE_RATES = {
        "auth_login": "100/min",
        "auth_register": "100/min",
        "auth_refresh": "100/min",
        "auth_password": "100/min",
        "auth_account": "100/min",
    }
    cache.clear()
    client = APIClient()
    assert register(client).status_code == 201
    existing_refresh = login(client).json()["refresh"]

    known = client.post(
        "/api/auth/password/forgot/",
        {"email": "USER@EXAMPLE.COM"},
        format="json",
    )
    unknown = client.post(
        "/api/auth/password/forgot/",
        {"email": "missing@example.com"},
        format="json",
    )
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json() == {"success": True}
    assert len(mail.outbox) == 1

    url = urlparse(mail.outbox[0].body.strip().splitlines()[-1])
    query = parse_qs(url.query)
    assert url.path == "/reset-password"
    reset = client.post(
        "/api/auth/password/reset/",
        {
            "uid": query["uid"][0],
            "token": query["token"][0],
            "new_password": "ResetStrong!890",
        },
        format="json",
    )
    assert reset.status_code == 200
    assert User.objects.get(email="user@example.com").check_password("ResetStrong!890")
    revoked_refresh = client.post(
        "/api/auth/refresh/",
        {"refresh": existing_refresh},
        format="json",
    )
    assert revoked_refresh.status_code == 401
    assert revoked_refresh.json()["success"] is False
    assert (
        client.post(
            "/api/auth/password/reset/",
            {
                "uid": query["uid"][0],
                "token": query["token"][0],
                "new_password": "ReuseStrong!891",
            },
            format="json",
        ).status_code
        == 400
    )
    assert login(client, password="ResetStrong!890").status_code == 200

    client.post(
        "/api/auth/password/forgot/",
        {"email": "user@example.com"},
        format="json",
    )
    second_url = urlparse(mail.outbox[-1].body.strip().splitlines()[-1])
    second_query = parse_qs(second_url.query)
    weak = client.post(
        "/api/auth/password/reset/",
        {
            "uid": second_query["uid"][0],
            "token": second_query["token"][0],
            "new_password": "short",
        },
        format="json",
    )
    assert weak.status_code == 400
    assert User.objects.get(email="user@example.com").check_password("ResetStrong!890")
    SimpleRateThrottle.THROTTLE_RATES = old_rates


def test_password_reset_rejects_malformed_uid_without_internal_error():
    response = APIClient().post(
        "/api/auth/password/reset/",
        {"uid": "!!!", "token": "invalid", "new_password": "StrongPass!234"},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
    assert "traceback" not in str(response.json()).lower()


def test_invalid_and_expired_tokens_have_normalized_errors():
    assert settings.DEBUG is False
    client = APIClient()
    invalid_login = client.post(
        "/api/auth/refresh/",
        {"refresh": "not-a-jwt"},
        format="json",
    )
    assert invalid_login.status_code == 401
    assert invalid_login.json()["success"] is False
    assert "traceback" not in str(invalid_login.json()).lower()
    invalid_access = APIClient().get(
        "/api/dashboard/", HTTP_AUTHORIZATION="Bearer invalid-access-token"
    )
    assert invalid_access.status_code == 401
    assert invalid_access.json()["success"] is False
    assert "traceback" not in str(invalid_access.json()).lower()

    assert register(client).status_code == 201
    tokens = login(client).json()
    last_signature_character = tokens["access"][-1]
    tampered_access = tokens["access"][:-1] + (
        "a" if last_signature_character != "a" else "b"
    )
    tampered_response = APIClient().get(
        "/api/dashboard/",
        HTTP_AUTHORIZATION=f"Bearer {tampered_access}",
    )
    assert tampered_response.status_code == 401
    assert tampered_response.json()["success"] is False
    from rest_framework_simplejwt.tokens import RefreshToken

    expired = RefreshToken(tokens["refresh"])
    expired.set_exp(from_time=expired.current_time, lifetime=timedelta(seconds=-1))
    response = client.post(
        "/api/auth/refresh/",
        {"refresh": str(expired)},
        format="json",
    )
    assert response.status_code == 401
    assert response.json()["success"] is False


def test_auth_endpoints_are_throttled():
    cache.clear()
    client = APIClient()
    responses = [
        register(client, email=f"user{index}@example.com") for index in range(11)
    ]
    assert all(response.status_code == 201 for response in responses[:10])
    assert responses[-1].status_code == 429
    assert responses[-1].json()["success"] is False
    cache.clear()


def test_password_validation_and_user_manager():
    response = register(APIClient(), password="short")
    assert response.status_code == 400
    assert set(response.json()["error"]["fields"]) == {"password"}
    assert not User.objects.filter(email="user@example.com").exists()

    superuser = User.objects.create_superuser("root@example.com", "StrongPass!234")
    assert superuser.is_staff
    assert superuser.is_superuser


# ── Per-scope throttle tests ──────────────────────────────────────────────────
# DRF sets SimpleRateThrottle.THROTTLE_RATES as a class attribute at import
# time from api_settings.DEFAULT_THROTTLE_RATES.  Because override_settings
# only updates the lazy api_settings object and not the already-set class
# attribute, HTTP throttle tests must also patch the class attribute directly.

_HIGH = {
    "auth_login": "100/min",
    "auth_register": "100/min",
    "auth_refresh": "100/min",
    "auth_password": "100/min",
    "auth_account": "100/min",
}


@pytest.fixture()
def throttle_rates(**rates):
    """Context manager: set SimpleRateThrottle.THROTTLE_RATES for the test."""
    from rest_framework.throttling import SimpleRateThrottle

    def _fixture(override):
        merged = {**_HIGH, **override}
        old = SimpleRateThrottle.THROTTLE_RATES
        SimpleRateThrottle.THROTTLE_RATES = merged
        yield
        SimpleRateThrottle.THROTTLE_RATES = old

    return _fixture


def test_each_view_has_its_own_throttle_scope():
    """Each view carries the expected throttle scope name."""
    from apps.accounts.views import (
        ChangeEmailView,
        ChangePasswordView,
        ForgotPasswordView,
        LoginView,
        LogoutView,
        RefreshView,
        RegisterView,
        ResetPasswordView,
    )

    assert LoginView.throttle_scope == "auth_login"
    assert RegisterView.throttle_scope == "auth_register"
    assert RefreshView.throttle_scope == "auth_refresh"
    assert ForgotPasswordView.throttle_scope == "auth_password"
    assert ResetPasswordView.throttle_scope == "auth_password"
    assert LogoutView.throttle_scope == "auth_account"
    assert ChangePasswordView.throttle_scope == "auth_account"
    assert ChangeEmailView.throttle_scope == "auth_account"
    # All unauthenticated scopes must be distinct so exhausting one
    # never blocks another endpoint.
    unauthenticated_scopes = [
        LoginView.throttle_scope,
        RegisterView.throttle_scope,
        RefreshView.throttle_scope,
        ForgotPasswordView.throttle_scope,
    ]
    assert len(set(unauthenticated_scopes)) == len(unauthenticated_scopes)


def test_throttle_rates_are_env_configurable():
    """Every auth scope has a rate entry in DEFAULT_THROTTLE_RATES."""
    from django.conf import settings

    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    assert set(rates) >= {
        "auth_login",
        "auth_register",
        "auth_refresh",
        "auth_password",
        "auth_account",
    }


def test_throttle_envelope_has_code_and_wait_message():
    """Throttled exception produces the standard envelope with code THROTTLED."""
    from rest_framework.exceptions import Throttled

    from config.exceptions import handler

    class _FakeRequest:
        pass

    exc = Throttled(wait=30)
    resp = handler(exc, {"request": _FakeRequest(), "view": None})
    assert resp.status_code == 429
    body = resp.data
    assert body["success"] is False
    assert body["error"]["code"] == "THROTTLED"
    msg = body["error"]["message"].lower()
    assert "wait" in msg or "too many" in msg


@pytest.mark.django_db(transaction=True)
def test_login_scope_is_throttled_at_configured_limit():
    """auth_login scope blocks after its configured limit."""
    from rest_framework.throttling import SimpleRateThrottle

    old_rates = SimpleRateThrottle.THROTTLE_RATES
    SimpleRateThrottle.THROTTLE_RATES = {**_HIGH, "auth_login": "2/min"}
    try:
        cache.clear()
        client = APIClient()
        assert register(client).status_code == 201
        login(client)
        login(client)
        blocked = login(client)
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "THROTTLED"
        assert "Retry-After" in blocked
        cache.clear()
    finally:
        SimpleRateThrottle.THROTTLE_RATES = old_rates


@pytest.mark.django_db(transaction=True)
def test_login_scope_does_not_affect_register_scope():
    """Exhausting auth_login leaves auth_register open."""
    from rest_framework.throttling import SimpleRateThrottle

    old_rates = SimpleRateThrottle.THROTTLE_RATES
    SimpleRateThrottle.THROTTLE_RATES = {**_HIGH, "auth_login": "2/min"}
    try:
        cache.clear()
        client = APIClient()
        assert register(client).status_code == 201
        login(client)
        login(client)
        assert login(client).status_code == 429
        assert register(client, email="different@example.com").status_code == 201
        cache.clear()
    finally:
        SimpleRateThrottle.THROTTLE_RATES = old_rates
