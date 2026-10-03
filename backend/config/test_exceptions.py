import pytest
from django.test import Client, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from apps.accounts.models import User
from config.exceptions import handler


@pytest.mark.parametrize(
    ("payload", "expected_message"),
    [
        (
            {"email": ["No registered user with that email."], "role": ["Invalid."]},
            "No registered user with that email.",
        ),
        (
            ["The first validation error.", "A second validation error."],
            "The first validation error.",
        ),
    ],
)
def test_validation_errors_include_first_readable_message_and_full_details(
    payload, expected_message
):
    request = APIRequestFactory().post("/api/organizations/1/members/")
    response = handler(
        ValidationError(payload), {"request": request, "view": APIView()}
    )

    assert response.status_code == 400
    assert response.data == {
        "success": False,
        "error": {
            "code": "INVALID",
            "message": expected_message,
            "details": payload,
        },
    }


def test_unknown_url_uses_standard_error_envelope():
    response = Client().get("/unknown-route/")

    assert response.status_code == 404
    assert response.json() == {
        "success": False,
        "error": {
            "code": "NOT_FOUND",
            "message": "The requested resource was not found.",
        },
    }


@override_settings(ROOT_URLCONF="config.test_urls", DEBUG=False)
def test_forced_server_error_uses_standard_error_envelope():
    response = Client(raise_request_exception=False).get("/forced-500/")

    assert response.status_code == 500
    assert response.json() == {
        "success": False,
        "error": {"code": "SERVER_ERROR", "message": "Unexpected error."},
    }


@pytest.mark.django_db
def test_method_not_allowed_uses_standard_error_envelope():
    user = User.objects.create_user("method@example.com", "StrongPass!234")
    client = APIClient()
    client.force_authenticate(user)

    response = client.put("/api/dashboard/", {}, format="json")

    assert response.status_code == 405
    assert response.json()["success"] is False
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
