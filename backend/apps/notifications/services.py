from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from apps.organizations.models import OrganizationMember

from .models import Notification


@transaction.atomic
def publish_notification(
    organization_id,
    event_type,
    message,
    task_id,
    recipients,
    actor_id=None,
    organization_wide=False,
):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        raise RuntimeError("The notification channel layer is not configured.")

    recipient_ids = {
        recipient.pk if hasattr(recipient, "pk") else int(recipient)
        for recipient in recipients
    }
    if actor_id is not None:
        recipient_ids.discard(actor_id)
    member_ids = set(
        OrganizationMember.objects.filter(
            organization_id=organization_id,
            user_id__in=recipient_ids,
        ).values_list("user_id", flat=True)
    )
    if not member_ids:
        return []

    notifications = Notification.objects.bulk_create(
        [
            Notification(
                organization_id=organization_id,
                recipient_id=recipient_id,
                task_id=task_id,
                event_type=event_type,
                message=message,
            )
            for recipient_id in member_ids
        ]
    )

    def deliver():
        for notification in notifications:
            payload = {
                "id": notification.id,
                "type": notification.event_type,
                "organization_id": organization_id,
                "task_id": task_id,
                "message": message,
                "created_at": notification.created_at.isoformat(),
            }
            recipient_id = notification.recipient_id
            group = (
                f"tasklane.org.{organization_id}"
                if organization_wide
                else f"tasklane.user.{recipient_id}"
            )
            async_to_sync(channel_layer.group_send)(
                group,
                {
                    "type": "notification",
                    "organization_id": organization_id,
                    "recipient_id": recipient_id,
                    "notification": payload,
                },
            )

    transaction.on_commit(deliver)
    return notifications


@transaction.atomic
def mark_notification_read(notification):
    if notification.read_at is None:
        notification.read_at = timezone.now()
        notification.save(update_fields=["read_at"])
    return notification


@transaction.atomic
def mark_all_notifications_read(notifications):
    return notifications.filter(read_at__isnull=True).update(read_at=timezone.now())


@transaction.atomic
def prune_read_notifications(days=60):
    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = Notification.objects.filter(
        read_at__isnull=False,
        read_at__lt=cutoff,
    ).delete()
    return deleted
