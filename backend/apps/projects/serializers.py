from rest_framework import serializers

from .models import Project


class ProjectSerializer(serializers.ModelSerializer):
    organization_id = serializers.IntegerField(write_only=True, required=False)

    class Meta:
        model = Project
        fields = [
            "id",
            "organization",
            "organization_id",
            "name",
            "description",
            "status",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["id", "organization", "created_by", "created_at"]
