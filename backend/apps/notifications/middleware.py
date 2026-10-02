from asgiref.sync import sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User


def _user_and_expiry_from_access_token(token):
    try:
        access_token = AccessToken(token)
        user_id = access_token["user_id"]
        expires_at = access_token["exp"]
    except (TokenError, KeyError, TypeError, ValueError):
        return AnonymousUser(), None
    user = User.objects.filter(pk=user_id, is_active=True).first()
    return (user or AnonymousUser(), expires_at if user else None)


class JWTAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        headers = dict(scope.get("headers", []))
        authorization = headers.get(b"authorization", b"").decode("latin1")
        bearer = authorization.split(" ", 1)
        token = (
            bearer[1] if len(bearer) == 2 and bearer[0].lower() == "bearer" else None
        )
        if not token:
            token = next(
                (
                    protocol.removeprefix("jwt.")
                    for protocol in scope.get("subprotocols", [])
                    if protocol.startswith("jwt.")
                ),
                None,
            )
        user, expires_at = (
            await sync_to_async(
                _user_and_expiry_from_access_token, thread_sensitive=True
            )(token)
            if token
            else (AnonymousUser(), None)
        )
        scope["user"] = user
        scope["jwt_exp"] = expires_at
        return await self.inner(scope, receive, send)
