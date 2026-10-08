from django.conf import settings
from django.db import models


class Notification(models.Model):
    class EventType(models.TextChoices):
        TASK_ASSIGNED = "task_assigned"
        COMMENT_ADDED = "comment_added"
        STATUS_CHANGED = "status_changed"
        TASK_OVERDUE = "task_overdue"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    task = models.ForeignKey(
        "tasks.Task",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notifications",
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    message = models.CharField(max_length=300)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # Supports each recipient's newest-first notification list.
            models.Index(
                fields=["recipient", "-created_at"], name="notif_recipient_recent_idx"
            ),
            # Supports unread-count queries by recipient without scanning read rows.
            models.Index(
                fields=["recipient"],
                condition=models.Q(read_at__isnull=True),
                name="notif_unread_recipient_idx",
            ),
        ]
