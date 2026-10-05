"""prune_stale_data management command.

Safe, opt-in housekeeping for PendingInvitation rows and orphaned user accounts.

Default: DRY RUN – nothing is deleted unless --yes is supplied.

Usage:
    # See what would be pruned (dry run)
    python manage.py prune_stale_data

    # Delete stale invitations (accepted/expired > 30 days ago)
    python manage.py prune_stale_data --yes

    # Also delete eligible orphaned user accounts
    python manage.py prune_stale_data --yes --users

    # Use a different age threshold
    python manage.py prune_stale_data --yes --days 60
"""

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone


class Command(BaseCommand):
    help = (
        "Prune stale PendingInvitation rows and (optionally) orphaned user accounts. "
        "Default is a DRY RUN; nothing is deleted without --yes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            default=False,
            help="Actually delete rows (default is a dry run).",
        )
        parser.add_argument(
            "--users",
            action="store_true",
            default=False,
            help="Also consider orphaned user accounts for deletion.",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Age threshold in days (default: 30).",
        )

    def handle(self, *args, **options):
        dry_run = not options["yes"]
        include_users = options["users"]
        days = options["days"]
        cutoff = timezone.now() - timezone.timedelta(days=days)

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"DRY RUN – nothing will be deleted.  "
                    f"Pass --yes to commit changes.  (threshold: {days} days)"
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"LIVE RUN – deletions are permanent.  (threshold: {days} days)"
                )
            )

        self.stdout.write("")
        self._prune_invitations(cutoff, dry_run)
        if include_users:
            self._prune_users(cutoff, dry_run)
        else:
            self.stdout.write(
                "  Users: skipped (pass --users to include orphaned accounts)\n"
            )

    # ── Invitations ────────────────────────────────────────────────────────────

    def _prune_invitations(self, cutoff, dry_run):
        from apps.organizations.models import PendingInvitation

        stale = PendingInvitation.objects.filter(
            Q(accepted_at__isnull=False, accepted_at__lt=cutoff)
            | Q(accepted_at__isnull=True, expires_at__lt=cutoff)
        )

        count = stale.count()
        self.stdout.write(f"Invitations older than threshold: {count}")

        if count == 0:
            self.stdout.write("  Nothing to do.\n")
            return

        for inv in stale.select_related("organization")[:20]:
            status = "accepted" if inv.accepted_at else "expired"
            self.stdout.write(
                f"  • [{status}] {inv.email} → {inv.organization.name} "
                f"(role={inv.role})"
            )
        if count > 20:
            self.stdout.write(f"  … and {count - 20} more")

        if dry_run:
            self.stdout.write(
                self.style.WARNING(f"  Would delete {count} invitation(s).\n")
            )
        else:
            deleted, _ = stale.delete()
            self.stdout.write(
                self.style.SUCCESS(f"  Deleted {deleted} invitation(s).\n")
            )

    # ── Users ──────────────────────────────────────────────────────────────────

    def _prune_users(self, cutoff, dry_run):
        from apps.accounts.models import User
        from apps.organizations.models import Organization
        from apps.tasks.models import Activity, Comment, Task

        # Base filter: no memberships, not staff/superuser, created before cutoff.
        candidates = User.objects.filter(
            date_joined__lt=cutoff,
            is_staff=False,
            is_superuser=False,
        ).exclude(
            memberships__isnull=False  # has at least one membership
        )

        # Exclude users who own an organization (Organization.owner → PROTECT).
        owned_org_user_ids = Organization.objects.values_list("owner_id", flat=True)
        candidates = candidates.exclude(pk__in=owned_org_user_ids)

        # Exclude users who created tasks (Task.created_by → PROTECT).
        task_creator_ids = Task.objects.values_list("created_by_id", flat=True)
        candidates = candidates.exclude(pk__in=task_creator_ids)

        # Exclude users who wrote comments (Comment.user → CASCADE – but
        # deleting them would remove other people's conversation context
        # since comments are attached to shared tasks, so keep them).
        comment_author_ids = Comment.objects.values_list("user_id", flat=True)
        candidates = candidates.exclude(pk__in=comment_author_ids)

        # Exclude users who have activity entries (actor nullable; keep for safety).
        activity_actor_ids = Activity.objects.filter(
            actor_id__isnull=False
        ).values_list("actor_id", flat=True)
        candidates = candidates.exclude(pk__in=activity_actor_ids)

        # Exclude users who sent invitations (PendingInvitation.invited_by → PROTECT).
        from apps.organizations.models import PendingInvitation

        invitation_sender_ids = PendingInvitation.objects.values_list(
            "invited_by_id", flat=True
        )
        candidates = candidates.exclude(pk__in=invitation_sender_ids)

        candidates = candidates.distinct()
        count = candidates.count()
        emails = list(candidates.values_list("email", flat=True)[:50])

        self.stdout.write(f"Orphaned users eligible for deletion: {count}")
        if count == 0:
            self.stdout.write("  Nothing to do.\n")
            return

        for email in emails:
            self.stdout.write(f"  • {email}")
        if count > 50:
            self.stdout.write(f"  … and {count - 50} more")

        if dry_run:
            self.stdout.write(self.style.WARNING(f"  Would delete {count} user(s).\n"))
        else:
            deleted, _ = candidates.delete()
            self.stdout.write(self.style.SUCCESS(f"  Deleted {deleted} user(s).\n"))
