import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()


def build_application():
    from apps.notifications.middleware import JWTAuthMiddleware
    from apps.notifications.routing import websocket_urlpatterns

    return ProtocolTypeRouter(
        {
            "http": django_asgi_app,
            "websocket": OriginValidator(
                JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
                settings.CORS_ALLOWED_ORIGINS,
            ),
        }
    )


application = build_application()
