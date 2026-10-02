import pytest
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

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
