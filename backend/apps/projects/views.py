from rest_framework import viewsets
from . import services
from .selectors import projects_for_user
from .serializers import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    filterset_fields = ["status", "organization"]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return projects_for_user(self.request.user, self.request.headers.get("X-Organization-ID"))

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
