from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone


@shared_task
def send_invitation_email(invitation_id):
    from .models import PendingInvitation

    invitation = (
        PendingInvitation.objects.select_related("organization")
        .filter(
            pk=invitation_id,
            accepted_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .first()
    )
    if invitation is None:
        return

    link = f"{settings.FRONTEND_URL}/register?invite={invitation.token}"
    send_mail(
        f"Invitation to join {invitation.organization.name}",
        (
            f"You have been invited to join {invitation.organization.name} "
            f"as {invitation.role.lower()}. Register at {link}"
        ),
        settings.DEFAULT_FROM_EMAIL,
        [invitation.email],
    )
