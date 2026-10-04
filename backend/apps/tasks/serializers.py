from rest_framework import serializers

from apps.projects.selectors import projects_for_user
from apps.projects.models import Project

from .models import Activity, Comment, Task


class TaskSerializer(serializers.ModelSerializer):
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.none())
    assigned_to_name = serializers.CharField(
        source="assigned_to.display_name", read_only=True, default=None
    )
    created_by_name = serializers.CharField(
        source="created_by.display_name", read_only=True
    )
    organization = serializers.IntegerField(
        source="project.organization_id", read_only=True
    )

    class Meta:
        model = Task
        fields = [
            "id",
            "project",
            "organization",
            "title",
            "description",
            "status",
            "priority",
            "assigned_to",
            "assigned_to_name",
            "created_by",
            "created_by_name",
            "due_date",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if (
            request and request.user.is_authenticated
        ):  # only projects the caller can see are valid targets
            fields["project"].queryset = projects_for_user(request.user)
        return fields


class CommentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.display_name", read_only=True)

    def validate(self, attrs):
        if self.partial and "content" not in attrs:
            raise serializers.ValidationError(
                {"content": "This field is required."}
            )
        return attrs

    def validate_content(self, value):
        if not value.strip():
            raise serializers.ValidationError("This field may not be blank.")
        return value.strip()

    class Meta:
        model = Comment
        fields = [
            "id",
            "task",
            "user",
            "user_name",
            "content",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "task", "user", "created_at", "updated_at"]


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Activity
        fields = ["id", "task", "verb", "message", "created_at"]
