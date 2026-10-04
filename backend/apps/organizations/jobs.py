"""Celery tasks for organization housekeeping."""

from datetime import timedelta

from celery import shared_task
from django.db.models import Q
from django.utils import timezone


@shared_task
def prune_stale_invitations(days=30):
    """Delete accepted or expired PendingInvitation rows older than *days* days.

    This runs automatically via Celery Beat and keeps the table lean.
    It never touches user accounts.
    """
    from apps.organizations.models import PendingInvitation

    cutoff = timezone.now() - timedelta(days=days)
    stale = PendingInvitation.objects.filter(
        Q(accepted_at__isnull=False, accepted_at__lt=cutoff)
        | Q(accepted_at__isnull=True, expires_at__lt=cutoff)
    )
    deleted_count, _ = stale.delete()
    return deleted_count
