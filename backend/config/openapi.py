def add_error_responses(result, generator, request, public):
    schemas = result.setdefault("components", {}).setdefault("schemas", {})
    schemas["ApiErrorDetail"] = {
        "type": "object",
        "required": ["code", "message"],
        "properties": {
            "code": {"type": "string"},
            "message": {"type": "string"},
            "details": {},
        },
    }
    schemas["ApiError"] = {
        "type": "object",
        "required": ["success", "error"],
        "properties": {
            "success": {"type": "boolean", "enum": [False]},
            "error": {"$ref": "#/components/schemas/ApiErrorDetail"},
        },
    }
    error_response = {
        "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/ApiError"}}
        }
    }
    descriptions = {
        "400": "Invalid request or validation failure.",
        "401": "Authentication required or credentials are invalid.",
        "403": "The caller does not have permission for this action.",
        "404": "The resource does not exist or is outside the caller's organization.",
        "405": "The HTTP method is not allowed for this endpoint.",
        "429": "The request was throttled.",
        "500": "Unexpected server error; stack traces are not returned.",
    }
    public_auth_paths = {
        "/api/auth/register/",
        "/api/auth/login/",
        "/api/auth/refresh/",
        "/api/auth/password/forgot/",
        "/api/auth/password/reset/",
    }
    for path, path_item in result.get("paths", {}).items():
        for method, operation in path_item.items():
            if not isinstance(operation, dict) or "responses" not in operation:
                continue
            has_organization_context = (
                path == "/api/activity/"
                or path == "/api/dashboard/"
                or path.startswith("/api/projects/")
                or path.startswith("/api/tasks/")
            )
            if has_organization_context:
                parameters = operation.setdefault("parameters", [])
                if not any(
                    parameter.get("name") == "X-Organization-ID"
                    for parameter in parameters
                ):
                    parameters.append(
                        {
                            "name": "X-Organization-ID",
                            "in": "header",
                            "required": False,
                            "description": (
                                "Optional organization context; it never grants access."
                            ),
                            "schema": {"type": "string"},
                        }
                    )
            error_codes = {"405", "500"}
            if method in {"post", "put", "patch"} or (
                method == "get"
                and path in {"/api/projects/", "/api/tasks/", "/api/organizations/"}
            ):
                error_codes.add("400")
            if path not in public_auth_paths or path == "/api/auth/login/":
                error_codes.add("401")
            if method in {"post", "put", "patch", "delete"} and not path.startswith(
                "/api/auth/"
            ):
                error_codes.add("403")
            if "{id}" in path:
                error_codes.add("404")
            if path.startswith("/api/auth/"):
                error_codes.add("429")
            for code in error_codes:
                operation["responses"].setdefault(
                    code,
                    {"description": descriptions[code], **error_response},
                )
    return result
