from datetime import timedelta
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
    cache.clear()
    yield
    cache.clear()


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

    tokens = login(client)
    assert tokens.status_code == 200
    assert set(tokens.json()) == {"access", "refresh"}
    assert login(client, password="wrong").status_code == 401


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
def test_forgot_password_is_non_enumerating_and_reset_token_is_single_use():
    client = APIClient()
    assert register(client).status_code == 201
    existing_refresh = login(client).json()["refresh"]

    known = client.post(
        "/api/auth/password/forgot/",
        {"email": "user@example.com"},
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
    assert not User.objects.filter(email="user@example.com").exists()

    superuser = User.objects.create_superuser("root@example.com", "StrongPass!234")
    assert superuser.is_staff
    assert superuser.is_superuser
