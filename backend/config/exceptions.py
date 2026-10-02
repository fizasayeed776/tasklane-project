from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler


def _first_message(value):
    if isinstance(value, dict):
        for nested_value in value.values():
            message = _first_message(nested_value)
            if message:
                return message
    elif isinstance(value, (list, tuple)):
        for nested_value in value:
            message = _first_message(nested_value)
            if message:
                return message
    elif isinstance(value, str) and value:
        return value
    return None


def handler(exc, context):
    """One error shape for every failure; never leaks stack traces."""
    resp = exception_handler(exc, context)
    if resp is None:
        return Response(
            {
                "success": False,
                "error": {"code": "SERVER_ERROR", "message": "Unexpected error."},
            },
            status=500,
        )
    data = resp.data
    detail = data.get("detail") if isinstance(data, dict) and "detail" in data else None
    is_validation_error = isinstance(exc, ValidationError)
    message = _first_message(data) if is_validation_error else None
    if detail:
        message = str(detail)
    error = {
        "code": getattr(exc, "default_code", "error").upper(),
        "message": message or "Validation failed.",
    }
    if is_validation_error or not detail:
        error["details"] = data
    resp.data = {"success": False, "error": error}
    return resp
