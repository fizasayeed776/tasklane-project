from rest_framework.response import Response
from rest_framework.views import exception_handler


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
    error = {
        "code": getattr(exc, "default_code", "error").upper(),
        "message": str(detail) if detail else "Validation failed.",
    }
    if not detail:
        error["details"] = data
    resp.data = {"success": False, "error": error}
    return resp
