from django.urls import path

from config.exceptions import not_found, server_error


def forced_server_error(request):
    raise RuntimeError("Forced test failure.")


urlpatterns = [path("forced-500/", forced_server_error)]
handler404 = not_found
handler500 = server_error
