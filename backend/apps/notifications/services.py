import uuid
from datetime import datetime, timezone

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def publish_notification(
    organization_id, event_type, message, task_id, recipient_id=None
):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        raise RuntimeError("The notification channel layer is not configured.")

    notification = {
        "id": str(uuid.uuid4()),
        "type": event_type,
        "organization_id": organization_id,
        "task_id": task_id,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    event = {
        "type": "notification",
        "organization_id": organization_id,
        "recipient_id": recipient_id,
        "notification": notification,
    }
    group = (
        f"tasklane.user.{recipient_id}"
        if recipient_id is not None
        else f"tasklane.org.{organization_id}"
    )
    async_to_sync(channel_layer.group_send)(group, event)
