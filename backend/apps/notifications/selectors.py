from apps.organizations.models import OrganizationMember

from .models import Notification


def organization_notification_recipients(organization_id, exclude_user_id=None):
    recipients = OrganizationMember.objects.filter(
        organization_id=organization_id
    ).values_list("user_id", flat=True)
    if exclude_user_id is not None:
        recipients = recipients.exclude(user_id=exclude_user_id)
    return list(recipients)


def notifications_for_user(user):
    return (
        Notification.objects.filter(
            recipient=user,
            organization__memberships__user=user,
        )
        .select_related("organization", "task")
        .order_by("-created_at", "-pk")
    )


def unread_notifications_for_user(user):
    return notifications_for_user(user).filter(read_at__isnull=True)
