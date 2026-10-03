from rest_framework import viewsets
from drf_spectacular.utils import OpenApiParameter, extend_schema_view, extend_schema

from . import services
from .models import Project
from .permissions import ProjectRolePermission
from .selectors import projects_for_user
from .serializers import ProjectSerializer


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                OpenApiParameter.QUERY,
                enum=["ACTIVE", "ARCHIVED"],
                description="Filter projects by lifecycle status.",
            ),
            OpenApiParameter(
                "organization",
                int,
                OpenApiParameter.QUERY,
                description="Optional organization filter; membership scope still applies.",
            ),
            OpenApiParameter(
                "X-Organization-ID",
                str,
                OpenApiParameter.HEADER,
                description="Optional organization context; it never grants access.",
            ),
        ]
    ),
)
class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.none()
    serializer_class = ProjectSerializer
    permission_classes = [ProjectRolePermission]
    filterset_fields = ["status", "organization"]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return projects_for_user(
            self.request.user, self.request.headers.get("X-Organization-ID")
        )

    def perform_create(self, serializer):
        serializer.instance = services.create_project(
            self.request.user, serializer.validated_data
        )

    def perform_update(self, serializer):
        serializer.instance = services.update_project(
            self.request.user, serializer.instance, serializer.validated_data
        )

    def perform_destroy(self, instance):
        services.delete_project(self.request.user, instance)
