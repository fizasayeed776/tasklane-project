from datetime import date

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.projects.selectors import projects_for_user

from . import selectors, services
from .serializers import ActivitySerializer, CommentSerializer, TaskSerializer


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    filterset_fields = ["status", "priority", "assigned_to", "project"]
    search_fields = ["title", "description"]
    ordering_fields = ["created_at", "due_date", "priority"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return selectors.tasks_for_user(
            self.request.user, self.request.headers.get("X-Organization-ID")
        )

    def perform_create(self, serializer):
        serializer.instance = services.create_task(
            self.request.user, dict(serializer.validated_data)
        )

    def perform_update(self, serializer):
        serializer.instance = services.update_task(
            self.request.user, serializer.instance, dict(serializer.validated_data)
        )

    def perform_destroy(self, instance):
        services.delete_task(self.request.user, instance)

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        task = self.get_object()
        if request.method == "POST":
            s = CommentSerializer(data=request.data)
            s.is_valid(raise_exception=True)
            c = services.add_comment(request.user, task, s.validated_data["content"])
            return Response(CommentSerializer(c).data, status=status.HTTP_201_CREATED)
        return Response(
            CommentSerializer(task.comments.select_related("user"), many=True).data
        )

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        return Response(
            ActivitySerializer(
                self.get_object().activities.order_by("-created_at"), many=True
            ).data
        )


class CommentViewSet(
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    serializer_class = CommentSerializer
    http_method_names = ["patch", "delete"]

    def get_queryset(self):
        return selectors.comments_for_user(self.request.user)

    def perform_update(self, serializer):
        services.update_comment(
            self.request.user, serializer.instance, serializer.validated_data["content"]
        )

    def perform_destroy(self, instance):
        services.delete_comment(self.request.user, instance)


class ActivityView(APIView):
    def get(self, request):
        qs = selectors.activity_for_user(
            request.user, request.headers.get("X-Organization-ID")
        )[:20]
        return Response(ActivitySerializer(qs, many=True).data)


class DashboardView(APIView):
    def get(self, request):
        org = request.headers.get("X-Organization-ID")
        tasks = selectors.tasks_for_user(request.user, org)
        return Response(
            {
                "total_projects": projects_for_user(request.user, org).count(),
                "total_tasks": tasks.count(),
                "assigned_to_me": tasks.filter(assigned_to=request.user).count(),
                "completed": tasks.filter(status="DONE").count(),
                "overdue": tasks.filter(due_date__lt=date.today())
                .exclude(status="DONE")
                .count(),
            }
        )
