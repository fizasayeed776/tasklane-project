from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.organizations.views import OrganizationViewSet
from apps.projects.views import ProjectViewSet
from apps.tasks.views import ActivityView, CommentViewSet, DashboardView, TaskViewSet
from apps.notifications.views import NotificationViewSet

router = DefaultRouter()
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("projects", ProjectViewSet, basename="project")
router.register("tasks", TaskViewSet, basename="task")
router.register("comments", CommentViewSet, basename="comment")
router.register("notifications", NotificationViewSet, basename="notification")
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/dashboard/", DashboardView.as_view()),
    path("api/activity/", ActivityView.as_view()),
    path("api/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
]

handler404 = "config.exceptions.not_found"
handler500 = "config.exceptions.server_error"
