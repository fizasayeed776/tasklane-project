from rest_framework import serializers

from .models import Notification


class NotificationOrganizationSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)


class NotificationSerializer(serializers.ModelSerializer):
    organization = NotificationOrganizationSerializer(read_only=True)
    task = serializers.IntegerField(source="task_id", read_only=True, allow_null=True)
    read = serializers.SerializerMethodField()

    def get_read(self, obj):
        return obj.read_at is not None

    class Meta:
        model = Notification
        fields = [
            "id",
            "event_type",
            "message",
            "organization",
            "task",
            "read",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields
